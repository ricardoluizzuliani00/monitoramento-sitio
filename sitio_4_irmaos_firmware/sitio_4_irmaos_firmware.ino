#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <Adafruit_AHTX0.h>
#include <Adafruit_BMP280.h>
#include <time.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <RTClib.h>
#include <sys/time.h>
#include "esp_sntp.h"

// ======================================================
// SITIO 4 IRMAOS
// 3 CAIXAS + CLIMA + CHUVA + BATERIA UPS + FIREBASE + TELEGRAM
// ======================================================

// ---------------- WIFI ----------------

struct RedeWiFi {
  const char* ssid;
  const char* senha;
};

const RedeWiFi REDES_WIFI[] = {
  {}
};

const int TOTAL_REDES_WIFI = sizeof(REDES_WIFI) / sizeof(REDES_WIFI[0]);

int redeWiFiAtual = -1;
int proximaRedeWiFi = 0;

// ---------------- FIREBASE ----------------

const char* FIREBASE_URL = "*********";

// ---------------- FIREBASE AUTH ----------------

const char* FIREBASE_API_KEY = "*********";

const char* FIREBASE_EMAIL = "*********";

// IMPORTANTE: preencha esta senha no seu PC antes de gravar.
const char* FIREBASE_PASSWORD = "*********";

String firebaseIdToken = "";

unsigned long firebaseTokenObtidoEm = 0;

const unsigned long FIREBASE_TOKEN_RELOGIN_MS = 50UL * 60UL * 1000UL;

// ---------------- TELEGRAM ----------------

// Token do bot (criado no BotFather) e o seu chat_id.
// IMPORTANTE: preencha no seu PC antes de gravar e nunca coloque
// estes dados nos arquivos .js do dashboard (eles ficam publicos).
const char* TELEGRAM_BOT_TOKEN = "*********";
const char* TELEGRAM_CHAT_ID = "*********";

// true = manda uma mensagem toda vez que o ESP32 liga
const bool AVISAR_INICIALIZACAO = true;

// So avisa "conexao restabelecida" se a queda durou pelo menos isto (segundos).
// Evita mensagem por piscadas curtas do Wi-Fi.
const long MIN_OFFLINE_AVISO_S = 120;

// ======================================================
// PINOS
// ======================================================

// Caixa 1
#define TRIG1 17
#define ECHO1 18

// Caixa 2
#define TRIG2 5
#define ECHO2 6

// Caixa Principal
#define TRIG3 10
#define ECHO3 11

// Sensor de chuva
#define SENSOR_CHUVA 4

// O sensor de chuva está desconectado no momento.
// Troque para true quando ele voltar a ser instalado.
const bool SENSOR_CHUVA_INSTALADO = true;

// I2C clima
#define SDA_PIN 8
#define SCL_PIN 9

// I2C do DS3231 (barramento separado, usa Wire1)
#define SDA_RTC_PIN 12
#define SCL_RTC_PIN 13

// Divisor de tensão da bateria do UPS
#define PIN_BAT 1

// ======================================================
// SENSORES
// ======================================================

Adafruit_AHTX0 aht;
Adafruit_BMP280 bmp;

bool ahtOK = false;
bool bmpOK = false;

// DS3231 (relogio com bateria) - barramento I2C proprio (Wire1)
RTC_DS3231 rtc;
bool rtcOK = false;

// A cada quanto tempo o DS3231 e reacertado pelo NTP
const unsigned long INTERVALO_SYNC_RTC_MS = 6UL * 60UL * 60UL * 1000UL;
unsigned long ultimaSincRTC = 0;

// ======================================================
// CONFIGURACAO DAS CAIXAS
// ======================================================

struct CaixaConfig {
  int numero;
  const char* nome;
  int trig;
  int echo;
  float capacidade;
  float cheia;
  float vazia;
  bool instalada;   // true = sensor ligado | false = ainda sem sensor
};

// QUANDO O SENSOR DE UMA CAIXA CHEGAR: ligue os fios nos pinos
// dela e troque o ultimo valor da linha de false para true.
// Caixa sem sensor (false) NAO e medida, nao envia nada ao
// Firebase e nao dispara alerta no Telegram (o pino ECHO solto
// capta ruido e inventava niveis falsos).
CaixaConfig caixas[] = {
  { 1, "Caixa 1",         TRIG1, ECHO1, 500.0,  20.0, 100.0, true  },
  { 2, "Caixa 2",         TRIG2, ECHO2, 500.0,  20.0, 100.0, false },
  { 3, "Caixa Principal", TRIG3, ECHO3, 1000.0, 20.0, 100.0, false }
};

const int TOTAL_CAIXAS = sizeof(caixas) / sizeof(caixas[0]);

// ======================================================
// INTERVALOS
// ======================================================

const unsigned long INTERVALO_LEITURA = 10000;
const unsigned long INTERVALO_HISTORICO = 300000;

unsigned long ultimaLeitura = 0;
unsigned long ultimoHistorico = 0;

// Historico do clima independente das caixas
const unsigned long INTERVALO_HISTORICO_CLIMA = 300000;
unsigned long ultimoHistoricoClima = 0;

// Reconexao do Wi-Fi
const unsigned long INTERVALO_RECONEXAO_WIFI = 10000;
unsigned long ultimaTentativaWiFi = 0;

// Histórico de conexão do ESP32. Quando o Wi-Fi cai, o horário da queda
// fica guardado em RAM e é enviado ao Firebase assim que a conexão volta.
bool wifiEstavaConectado = false;
long timestampQuedaPendente = 0;

// Evita repetir eventos de chuva iguais consecutivamente.
String ultimoStatusChuvaRegistrado = "";

// ======================================================
// DATA E HORA
// ======================================================

// Consideramos o relógio válido somente depois de 01/01/2024.
// Isso evita gravar históricos com timestamp 0/1970 antes do NTP sincronizar.
const time_t TIMESTAMP_MINIMO_VALIDO = 1704067200;

String getDataHora();

bool horarioValido() {
  time_t agora = time(nullptr);
  return agora >= TIMESTAMP_MINIMO_VALIDO;
}

// ---------------- DS3231 (RELOGIO COM BATERIA) ----------------
// O DS3231 guarda a hora em UTC. Se a internet estiver fora quando o ESP32
// ligar (ex.: reinicio depois de queda de energia), a hora vem dele.
// Quando o NTP sincroniza, o DS3231 e acertado de volta.

volatile bool ntpSincronizado = false;

void aoSincronizarNTP(struct timeval* tv) {
  ntpSincronizado = true;
}

void iniciarRTC() {

  Wire1.begin(SDA_RTC_PIN, SCL_RTC_PIN);

  if (rtc.begin(&Wire1)) {
    rtcOK = true;
    Serial.println("DS3231 OK!");
  } else {
    Serial.println("DS3231 NAO ENCONTRADO");
  }
}

void carregarHoraDoRTC() {

  if (!rtcOK) {
    return;
  }

  if (rtc.lostPower()) {
    Serial.println("DS3231: hora invalida (sem bateria ou descarregada). Aguardando NTP.");
    return;
  }

  time_t epoch = (time_t)rtc.now().unixtime();

  if (epoch < TIMESTAMP_MINIMO_VALIDO) {
    Serial.println("DS3231: hora fora do esperado. Aguardando NTP.");
    return;
  }

  setenv("TZ", "BRT3", 1);
  tzset();

  struct timeval tv;
  tv.tv_sec = epoch;
  tv.tv_usec = 0;
  settimeofday(&tv, nullptr);

  Serial.print("Hora restaurada pelo DS3231: ");
  Serial.println(getDataHora());
}

// Acerta o DS3231 com a hora do NTP (so se estiver online e sincronizado).
void atualizarRTCComNTP() {

  if (!rtcOK || !ntpSincronizado || WiFi.status() != WL_CONNECTED || !horarioValido()) {
    return;
  }

  time_t agora = time(nullptr);
  long diferenca = (long)agora - (long)rtc.now().unixtime();

  if (rtc.lostPower() || labs(diferenca) >= 2) {
    rtc.adjust(DateTime((uint32_t)agora));
    Serial.print("DS3231 acertado pelo NTP (diferenca de ");
    Serial.print(diferenca);
    Serial.println(" s)");
  }

  ultimaSincRTC = millis();
}

void manterRelogioRTC() {

  if (!rtcOK) {
    return;
  }

  if (ultimaSincRTC != 0 && millis() - ultimaSincRTC < INTERVALO_SYNC_RTC_MS) {
    return;
  }

  atualizarRTCComNTP();
}

bool sincronizarHorario(unsigned long timeoutMs = 30000) {

  // Minas Gerais: UTC-3, sem horário de verão atualmente.
  setenv("TZ", "BRT3", 1);
  tzset();

  // Trabalhamos com UTC no SNTP e aplicamos o fuso via TZ.
  sntp_set_time_sync_notification_cb(aoSincronizarNTP);
  configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");

  // CORRECAO DO FUSO: o configTime() acima redefine o fuso para UTC
  // (por isso a hora local "pulava" 3 horas depois do NTP). Aqui o
  // fuso do Brasil e aplicado DE NOVO, depois do configTime().
  // Isso muda so o TEXTO da hora (getDataHora). O timestamp
  // (segundos desde 1970, em UTC) continua exatamente igual.
  setenv("TZ", "BRT3", 1);
  tzset();

  Serial.print("Sincronizando horario");

  unsigned long inicio = millis();

  while (!ntpSincronizado && millis() - inicio < timeoutMs) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (!ntpSincronizado) {

    if (horarioValido()) {
      Serial.println("NTP indisponivel: usando a hora do DS3231");
      Serial.print("Horario: ");
      Serial.println(getDataHora());
      return true;
    }

    Serial.println("AVISO: horario NTP ainda nao sincronizado");
    return false;
  }

  atualizarRTCComNTP();

  Serial.print("Horario: ");
  Serial.println(getDataHora());

  return true;
}

String getDataHora() {

  if (!horarioValido()) {
    return "sem_horario";
  }

  time_t agora = time(nullptr);
  struct tm timeinfo;

  if (!localtime_r(&agora, &timeinfo)) {
    return "sem_horario";
  }

  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &timeinfo);
  return String(buffer);
}

long getTimestamp() {

  time_t agora = time(nullptr);

  if (agora < TIMESTAMP_MINIMO_VALIDO) {
    return 0;
  }

  return (long)agora;
}

String formatarDataHoraTimestamp(long timestamp) {

  if (timestamp <= 0) {
    return "sem_horario";
  }

  time_t valor = (time_t)timestamp;
  struct tm timeinfo;

  if (!localtime_r(&valor, &timeinfo)) {
    return "sem_horario";
  }

  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &timeinfo);
  return String(buffer);
}

// Converte segundos em texto: "45 s", "12 min", "3 h 20 min", "1 d 4 h"
String formatarDuracao(long segundos) {

  if (segundos < 60) {
    return String(segundos) + " s";
  }

  long minutos = segundos / 60;

  if (minutos < 60) {
    return String(minutos) + " min";
  }

  long horas = minutos / 60;
  long minutosRestantes = minutos % 60;

  if (horas < 24) {
    return String(horas) + " h " + String(minutosRestantes) + " min";
  }

  long dias = horas / 24;
  long horasRestantes = horas % 24;

  return String(dias) + " d " + String(horasRestantes) + " h";
}

// ======================================================
// TELEGRAM (com fila para nao perder mensagens se a internet cair)
// ======================================================

const int TAM_FILA_TELEGRAM = 8;
String filaTelegram[TAM_FILA_TELEGRAM];
int filaTelegramInicio = 0;
int filaTelegramQtd = 0;

const unsigned long INTERVALO_RETENTATIVA_TELEGRAM = 15000;
unsigned long ultimaFalhaTelegram = 0;

// Retorna o codigo HTTP (200 = enviado) ou um valor <= 0 em falha de rede.
int enviarTelegram(const String& texto) {

  if (strlen(TELEGRAM_BOT_TOKEN) == 0 || strlen(TELEGRAM_CHAT_ID) == 0) {
    Serial.println("Telegram: token/chat_id nao configurados");
    return 400;
  }

  if (WiFi.status() != WL_CONNECTED) {
    return -1;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;

  String url = "https://api.telegram.org/bot" + String(TELEGRAM_BOT_TOKEN) + "/sendMessage";

  if (!https.begin(client, url)) {
    return -1;
  }

  https.setTimeout(8000);
  https.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["chat_id"] = TELEGRAM_CHAT_ID;
  doc["text"] = texto;

  String json;
  serializeJson(doc, json);

  int codigo = https.POST(json);

  Serial.print("Telegram: HTTP ");
  Serial.println(codigo);

  https.end();

  return codigo;
}

void enfileirarTelegram(const String& texto) {

  // Se a fila encheu, descarta a mensagem mais antiga.
  if (filaTelegramQtd >= TAM_FILA_TELEGRAM) {
    filaTelegram[filaTelegramInicio] = "";
    filaTelegramInicio = (filaTelegramInicio + 1) % TAM_FILA_TELEGRAM;
    filaTelegramQtd--;
  }

  int posicao = (filaTelegramInicio + filaTelegramQtd) % TAM_FILA_TELEGRAM;
  filaTelegram[posicao] = texto;
  filaTelegramQtd++;

  Serial.println("Telegram: mensagem na fila");
}

void processarFilaTelegram() {

  if (filaTelegramQtd == 0) {
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  unsigned long agora = millis();

  if (ultimaFalhaTelegram != 0 &&
      agora - ultimaFalhaTelegram < INTERVALO_RETENTATIVA_TELEGRAM) {
    return;
  }

  int codigo = enviarTelegram(filaTelegram[filaTelegramInicio]);

  bool enviada = (codigo == 200);

  // Erro 4xx (exceto 429) = token/chat_id errado: descarta para nao travar a fila.
  bool descartar = (codigo >= 400 && codigo < 500 && codigo != 429);

  if (enviada || descartar) {

    if (descartar) {
      Serial.println("Telegram: mensagem descartada (verifique token e chat_id)");
    }

    filaTelegram[filaTelegramInicio] = "";
    filaTelegramInicio = (filaTelegramInicio + 1) % TAM_FILA_TELEGRAM;
    filaTelegramQtd--;
    ultimaFalhaTelegram = 0;
    return;
  }

  // Falha de rede ou limite do Telegram: tenta de novo depois.
  ultimaFalhaTelegram = agora;
}

// ======================================================
// SENSOR ULTRASSONICO
// ======================================================

float medirUmaVez(int trig, int echo) {

  digitalWrite(trig, LOW);
  delayMicroseconds(5);

  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);

  long duracao = pulseIn(echo, HIGH, 30000);

  if (duracao == 0) {
    return -1;
  }

  float distancia = duracao * 0.0343 / 2.0;

  if (distancia < 20 || distancia > 400) {
    return -1;
  }

  return distancia;
}

float medirDistancia(int trig, int echo) {

  float soma = 0;
  int validas = 0;

  for (int i = 0; i < 5; i++) {

    float d = medirUmaVez(trig, echo);

    if (d > 0) {
      soma += d;
      validas++;
    }

    delay(100);
  }

  if (validas == 0) {
    return -1;
  }

  return soma / validas;
}

/*
  FILTRO DE OSCILACAO - CAIXA 1
  Descarta saltos isolados e confirma mudancas persistentes.
  As outras caixas permanecem inalteradas.
*/

const float SALTO_MAXIMO_CAIXA1_CM = 8.0;
const float TOLERANCIA_CONFIRMACAO_CAIXA1_CM = 4.0;

struct EstadoFiltroDistancia {
  bool inicializado = false;
  float distanciaAceita = 0;
  float distanciaCandidata = 0;
  int repeticoesCandidata = 0;
};

EstadoFiltroDistancia filtroCaixa1;

float filtrarDistanciaCaixa(
  const CaixaConfig& caixa,
  float distancia
) {
  // Nao alterar o comportamento das outras caixas.
  if (caixa.numero != 1) {
    return distancia;
  }

  EstadoFiltroDistancia& f = filtroCaixa1;

  // Primeira leitura valida apos ligar o ESP32.
  if (!f.inicializado) {
    f.inicializado = true;
    f.distanciaAceita = distancia;
    return distancia;
  }

  float diferenca = fabs(distancia - f.distanciaAceita);

  // Variacao pequena: aceita e limpa qualquer suspeita anterior.
  if (diferenca <= SALTO_MAXIMO_CAIXA1_CM) {
    f.distanciaAceita = distancia;
    f.distanciaCandidata = 0;
    f.repeticoesCandidata = 0;
    return distancia;
  }

  // Variacao grande: exige duas leituras semelhantes.
  if (f.distanciaCandidata > 0 &&
      fabs(distancia - f.distanciaCandidata) <=
      TOLERANCIA_CONFIRMACAO_CAIXA1_CM) {

    f.repeticoesCandidata++;

  } else {

    f.distanciaCandidata = distancia;
    f.repeticoesCandidata = 1;
  }

  if (f.repeticoesCandidata < 2) {
    Serial.printf(
      "Caixa 1: leitura suspeita %.1f cm; "
      "anterior %.1f cm. Aguardando confirmacao.\n",
      distancia,
      f.distanciaAceita
    );

    // Sinaliza que esta leitura deve ser ignorada.
    return -2;
  }

  // A mudanca foi confirmada em leituras consecutivas.
  Serial.printf(
    "Caixa 1: nova distancia confirmada: %.1f cm\n",
    distancia
  );

  f.distanciaAceita = distancia;
  f.distanciaCandidata = 0;
  f.repeticoesCandidata = 0;

  return distancia;
}

// ======================================================
// NIVEL
// ======================================================

float calcularNivel(float distancia, float cheia, float vazia) {

  float nivel = ((vazia - distancia) / (vazia - cheia)) * 100.0;

  if (nivel > 100) {
    nivel = 100;
  }

  if (nivel < 0) {
    nivel = 0;
  }

  return nivel;
}

String calcularStatus(float nivel) {

  if (nivel >= 70) {
    return "cheia";
  }

  if (nivel >= 30) {
    return "normal";
  }

  if (nivel >= 15) {
    return "baixo";
  }

  return "critico";
}

// ======================================================
// ALERTAS DAS CAIXAS (TELEGRAM)
// ======================================================

// Quantas leituras seguidas com o mesmo status antes de avisar
// (evita aviso por uma leitura ruim do sensor).
const int CONFIRMACOES_STATUS = 3;

// Aviso de "caixa cheia": dispara ao passar de 95% e so rearma abaixo de 85%.
const float NIVEL_AVISO_CHEIA = 95.0;
const float NIVEL_REARME_CHEIA = 85.0;

// Queda brusca: 10 pontos percentuais em ate 1 minuto, com cooldown de 10 min.
const float QUEDA_BRUSCA_PONTOS = 10.0;
const unsigned long JANELA_QUEDA_MS = 60000UL;
const unsigned long COOLDOWN_QUEDA_MS = 600000UL;
const int AMOSTRAS_QUEDA_CONSECUTIVAS = 2;

const int TAM_HIST_NIVEL = 12;

struct EstadoAlertaCaixa {
  bool inicializado;
  String statusConfirmado;
  String statusCandidato;
  int contagemCandidato;
  bool avisouCheia;
  int quedaConsecutiva;
  unsigned long ultimoAvisoQueda;
  unsigned long histT[TAM_HIST_NIVEL];
  float histN[TAM_HIST_NIVEL];
  int histQtd;
};

EstadoAlertaCaixa alertas[TOTAL_CAIXAS];

int rankStatus(const String& status) {
  if (status == "critico") return 0;
  if (status == "baixo") return 1;
  if (status == "normal") return 2;
  return 3;
}

String descricaoCaixa(const CaixaConfig& caixa, float nivel, float litros) {
  return String(caixa.nome) + ": " + String(nivel, 1) + "% (" +
         String(litros, 0) + " L de " + String(caixa.capacidade, 0) + " L)";
}

void verificarAlertasCaixa(
  const CaixaConfig& caixa,
  float nivel,
  float litros,
  const String& status
) {

  int indice = caixa.numero - 1;

  if (indice < 0 || indice >= TOTAL_CAIXAS) {
    return;
  }

  EstadoAlertaCaixa& e = alertas[indice];
  unsigned long agora = millis();

  // Primeira leitura depois de ligar: so registra o estado, sem avisar.
  if (!e.inicializado) {
    e.inicializado = true;
    e.avisouCheia = (nivel >= NIVEL_AVISO_CHEIA);
  }

  // ---------------------------------------------
  // 1) NIVEL BAIXO / CRITICO / VOLTOU AO NORMAL
  // ---------------------------------------------

  if (status == e.statusCandidato) {
    if (e.contagemCandidato < 100) {
      e.contagemCandidato++;
    }
  } else {
    e.statusCandidato = status;
    e.contagemCandidato = 1;
  }

  if (e.contagemCandidato >= CONFIRMACOES_STATUS && status != e.statusConfirmado) {

    String anterior = e.statusConfirmado;
    e.statusConfirmado = status;

    // Na primeira confirmacao depois de ligar (anterior vazio) nao avisa.
    if (anterior.length() > 0) {

      int rNovo = rankStatus(status);
      int rAnterior = rankStatus(anterior);

      if (rNovo <= 1 && rNovo < rAnterior) {

        if (status == "critico") {
          enfileirarTelegram(
            "🚨 NIVEL CRITICO\n" +
            descricaoCaixa(caixa, nivel, litros) +
            "\n🕒 " + getDataHora()
          );
        } else {
          enfileirarTelegram(
            "⚠️ Nivel baixo\n" +
            descricaoCaixa(caixa, nivel, litros) +
            "\n🕒 " + getDataHora()
          );
        }

      } else if (rNovo >= 2 && rAnterior <= 1) {

        enfileirarTelegram(
          "✅ Nivel normalizado\n" +
          descricaoCaixa(caixa, nivel, litros) +
          "\n🕒 " + getDataHora()
        );
      }
    }
  }

  // ---------------------------------------------
  // 2) CAIXA CHEIA
  // ---------------------------------------------

  if (!e.avisouCheia && nivel >= NIVEL_AVISO_CHEIA) {

    e.avisouCheia = true;

    enfileirarTelegram(
      "💧 Caixa cheia \n" +
      descricaoCaixa(caixa, nivel, litros) +
      "\n🕒 " + getDataHora()
    );

  } else if (e.avisouCheia && nivel < NIVEL_REARME_CHEIA) {

    e.avisouCheia = false;
  }

  // ---------------------------------------------
  // 3) QUEDA BRUSCA
  // ---------------------------------------------

  // Guarda a amostra atual (descarta a mais antiga se encher).
  int posicao;

  if (e.histQtd < TAM_HIST_NIVEL) {
    posicao = e.histQtd;
    e.histQtd++;
  } else {
    for (int i = 0; i < TAM_HIST_NIVEL - 1; i++) {
      e.histT[i] = e.histT[i + 1];
      e.histN[i] = e.histN[i + 1];
    }
    posicao = TAM_HIST_NIVEL - 1;
  }

  e.histT[posicao] = agora;
  e.histN[posicao] = nivel;

  // Maior nivel registrado no ultimo minuto.
  float nivelMaximo = nivel;

  for (int i = 0; i < e.histQtd; i++) {
    if (agora - e.histT[i] <= JANELA_QUEDA_MS && e.histN[i] > nivelMaximo) {
      nivelMaximo = e.histN[i];
    }
  }

  float queda = nivelMaximo - nivel;

  if (queda >= QUEDA_BRUSCA_PONTOS) {
    e.quedaConsecutiva++;
  } else {
    e.quedaConsecutiva = 0;
  }

  bool cooldownOk =
    (e.ultimoAvisoQueda == 0) ||
    (agora - e.ultimoAvisoQueda >= COOLDOWN_QUEDA_MS);

  if (e.quedaConsecutiva >= AMOSTRAS_QUEDA_CONSECUTIVAS && cooldownOk) {

    e.ultimoAvisoQueda = agora;
    e.quedaConsecutiva = 0;

    
    enfileirarTelegram(
      "📉 QUEDA DE NIVEL CONFIRMADA\n" +
      String(caixa.nome) +
      "\nQueda de " + String(queda, 1) +
      " pontos percentuais em menos de 1 min." +
      "\nNivel anterior: " + String(nivelMaximo, 1) + "%" +
      "\nNivel atual: " + String(nivel, 1) + "%" +
      "\n" + descricaoCaixa(caixa, nivel, litros) +
      "\nPossivel vazamento ou torneira aberta." +
      "\nLeitura confirmada em medicoes consecutivas." +
      "\n" + getDataHora()
    );
  }

}

// ======================================================
// FIREBASE - AUTENTICACAO
// ======================================================

bool autenticarFirebase() {

  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;

  String url =
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" +
    String(FIREBASE_API_KEY);

  if (!https.begin(client, url)) {
    Serial.println("Firebase Auth: falha ao iniciar HTTPS");
    return false;
  }

  https.addHeader("Content-Type", "application/json");

  JsonDocument pedido;
  pedido["email"] = FIREBASE_EMAIL;
  pedido["password"] = FIREBASE_PASSWORD;
  pedido["returnSecureToken"] = true;

  String json;
  serializeJson(pedido, json);

  int codigo = https.POST(json);
  String resposta = https.getString();

  Serial.print("Firebase Auth: HTTP ");
  Serial.println(codigo);

  if (codigo == 200) {

    JsonDocument doc;
    DeserializationError erro = deserializeJson(doc, resposta);

    if (!erro) {

      const char* token = doc["idToken"];

      if (token != nullptr && strlen(token) > 0) {
        firebaseIdToken = String(token);
        firebaseTokenObtidoEm = millis();
        https.end();
        Serial.println("Firebase autenticado!");
        return true;
      }

      Serial.println("Firebase Auth: idToken ausente.");

    } else {
      Serial.print("Firebase Auth: erro ao interpretar JSON: ");
      Serial.println(erro.c_str());
    }

  } else {

    // Mostra apenas a mensagem de erro, sem imprimir tokens.
    JsonDocument docErro;

    if (deserializeJson(docErro, resposta) == DeserializationError::Ok) {
      const char* mensagem = docErro["error"]["message"];
      if (mensagem) {
        Serial.print("Firebase Auth erro: ");
        Serial.println(mensagem);
      }
    }
  }

  Serial.println("Falha na autenticacao do Firebase.");
  https.end();
  return false;
}

bool garantirFirebaseAuth() {

  if (firebaseIdToken.length() == 0 ||
      millis() - firebaseTokenObtidoEm >= FIREBASE_TOKEN_RELOGIN_MS) {
    return autenticarFirebase();
  }

  return true;
}

String urlFirebaseAutenticada(const String& caminho) {
  return String(FIREBASE_URL) + caminho + ".json?auth=" + firebaseIdToken;
}

void invalidarFirebaseAuth() {
  firebaseIdToken = "";
  firebaseTokenObtidoEm = 0;
}

// ======================================================
// FIREBASE - CAIXAS
// ======================================================

void enviarCaixa(
  const CaixaConfig& caixa,
  float distancia,
  float nivel,
  float litros,
  String status
) {

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;

  if (!garantirFirebaseAuth()) {
    return;
  }

  String url = urlFirebaseAutenticada("/caixas/caixa" + String(caixa.numero));

  https.begin(client, url);
  https.addHeader("Content-Type", "application/json");

  String json = "{";
  json += "\"nome\":\"";
  json += caixa.nome;
  json += "\",";
  json += "\"capacidade_litros\":";
  json += String(caixa.capacidade, 0);
  json += ",";
  json += "\"distancia_cm\":";
  json += String(distancia, 1);
  json += ",";
  json += "\"nivel_percentual\":";
  json += String(nivel, 1);
  json += ",";
  json += "\"litros\":";
  json += String(litros, 0);
  json += ",";
  json += "\"status\":\"";
  json += status;
  json += "\",";
  json += "\"online\":true,";
  json += "\"ultima_atualizacao\":\"";
  json += getDataHora();
  json += "\",";
  json += "\"timestamp\":";
  json += String(getTimestamp());
  json += "}";

  int codigo = https.PUT(json);

  if (codigo == 401) {

    https.end();
    invalidarFirebaseAuth();

    if (autenticarFirebase()) {

      WiFiClientSecure retryClient;
      retryClient.setInsecure();

      HTTPClient retryHttps;

      String retryUrl = urlFirebaseAutenticada("/caixas/caixa" + String(caixa.numero));

      if (retryHttps.begin(retryClient, retryUrl)) {
        retryHttps.addHeader("Content-Type", "application/json");
        codigo = retryHttps.PUT(json);
        retryHttps.end();
      }
    }
  }

  Serial.print(caixa.nome);
  Serial.print(" Firebase: HTTP ");
  Serial.println(codigo);

  https.end();
}

// ======================================================
// HISTORICO DAS CAIXAS
// ======================================================

void salvarHistoricoCaixa(
  const CaixaConfig& caixa,
  float distancia,
  float nivel,
  float litros
) {

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;

  if (!garantirFirebaseAuth()) {
    return;
  }

  String url = urlFirebaseAutenticada("/historico/caixa" + String(caixa.numero));

  https.begin(client, url);
  https.addHeader("Content-Type", "application/json");

  String json = "{";
  json += "\"distancia_cm\":";
  json += String(distancia, 1);
  json += ",";
  json += "\"nivel_percentual\":";
  json += String(nivel, 1);
  json += ",";
  json += "\"litros\":";
  json += String(litros, 0);
  json += ",";
  json += "\"data_hora\":\"";
  json += getDataHora();
  json += "\",";
  json += "\"timestamp\":";
  json += String(getTimestamp());
  json += "}";

  int codigo = https.POST(json);

  if (codigo == 401) {

    https.end();
    invalidarFirebaseAuth();

    if (autenticarFirebase()) {

      WiFiClientSecure retryClient;
      retryClient.setInsecure();

      HTTPClient retryHttps;

      String retryUrl = urlFirebaseAutenticada("/historico/caixa" + String(caixa.numero));

      if (retryHttps.begin(retryClient, retryUrl)) {
        retryHttps.addHeader("Content-Type", "application/json");
        codigo = retryHttps.POST(json);
        retryHttps.end();
      }
    }
  }

  Serial.print("Historico ");
  Serial.print(caixa.nome);
  Serial.print(": HTTP ");
  Serial.println(codigo);

  https.end();
}

// ======================================================
// LEITURA DE UMA CAIXA
// ======================================================


void processarCaixa(const CaixaConfig& caixa, bool salvarHistorico) {

  // Sensor nao instalado: nao mede, nao envia, nao alerta.
  if (!caixa.instalada) {
    return;
  }

  float distancia = medirDistancia(caixa.trig, caixa.echo);

  if (distancia <= 0) {
    Serial.println();
    Serial.print(caixa.nome);
    Serial.println(": sem leitura valida");
    return;
  }

  distancia = filtrarDistanciaCaixa(caixa, distancia);

  if (distancia == -2) {
    return;
  }

  float nivel = calcularNivel(distancia, caixa.cheia, caixa.vazia);

  float litros = caixa.capacidade * (nivel / 100.0);

  String status = calcularStatus(nivel);

  Serial.println();
  Serial.println(caixa.nome);

  Serial.print("Distancia: ");
  Serial.print(distancia, 1);
  Serial.println(" cm");

  Serial.print("Nivel: ");
  Serial.print(nivel, 1);
  Serial.println(" %");

  Serial.print("Litros: ");
  Serial.print(litros, 0);
  Serial.println(" L");

  // Alertas do Telegram (nivel baixo/critico, cheia, queda brusca)
  verificarAlertasCaixa(caixa, nivel, litros, status);

  enviarCaixa(caixa, distancia, nivel, litros, status);

  if (salvarHistorico) {
    salvarHistoricoCaixa(caixa, distancia, nivel, litros);
  }
}

// ======================================================
// FIREBASE - CLIMA
// ======================================================

void enviarClima(float temperatura, float umidade, float pressao) {

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;

  if (!garantirFirebaseAuth()) {
    return;
  }

  String url = urlFirebaseAutenticada("/clima");

  https.begin(client, url);
  https.addHeader("Content-Type", "application/json");

  String json = "{";
  json += "\"temperatura\":";
  json += String(temperatura, 1);
  json += ",";
  json += "\"umidade\":";
  json += String(umidade, 1);
  json += ",";
  json += "\"pressao\":";
  json += String(pressao, 1);
  json += ",";
  json += "\"online\":true,";
  json += "\"ultima_atualizacao\":\"";
  json += getDataHora();
  json += "\",";
  json += "\"timestamp\":";
  json += String(getTimestamp());
  json += "}";

  int codigo = https.PUT(json);

  if (codigo == 401) {

    https.end();
    invalidarFirebaseAuth();

    if (autenticarFirebase()) {

      WiFiClientSecure retryClient;
      retryClient.setInsecure();

      HTTPClient retryHttps;

      String retryUrl = urlFirebaseAutenticada("/clima");

      if (retryHttps.begin(retryClient, retryUrl)) {
        retryHttps.addHeader("Content-Type", "application/json");
        codigo = retryHttps.PUT(json);
        retryHttps.end();
      }
    }
  }

  Serial.print("Clima Firebase: HTTP ");
  Serial.println(codigo);

  https.end();
}

// ======================================================
// HISTORICO DO CLIMA
// ======================================================

void salvarHistoricoClima(float temperatura, float umidade, float pressao) {

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (!garantirFirebaseAuth()) {
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;

  String url = urlFirebaseAutenticada("/historico/clima");

  if (!https.begin(client, url)) {
    Serial.println("Historico clima: falha ao iniciar HTTPS");
    return;
  }

  https.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["temperatura"] = temperatura;
  doc["umidade"] = umidade;
  doc["pressao"] = pressao;
  doc["data_hora"] = getDataHora();
  doc["timestamp"] = getTimestamp();

  String json;
  serializeJson(doc, json);

  int codigo = https.POST(json);

  if (codigo == 401) {

    https.end();
    invalidarFirebaseAuth();

    if (autenticarFirebase()) {

      WiFiClientSecure retryClient;
      retryClient.setInsecure();

      HTTPClient retryHttps;

      String retryUrl = urlFirebaseAutenticada("/historico/clima");

      if (retryHttps.begin(retryClient, retryUrl)) {
        retryHttps.addHeader("Content-Type", "application/json");
        codigo = retryHttps.POST(json);
        retryHttps.end();
      }
    }
  }

  Serial.print("Historico clima: HTTP ");
  Serial.println(codigo);

  https.end();
}

// ======================================================
// CHUVA
// ======================================================

String calcularStatusChuva(int valor) {

  if (valor > 3800) {
    return "seco";
  }

  if (valor > 3500) {
    return "gotas";
  }

  return "chuva";
}

void enviarChuva(int valor, String status) {

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;

  if (!garantirFirebaseAuth()) {
    return;
  }

  String url = urlFirebaseAutenticada("/chuva");

  https.begin(client, url);
  https.addHeader("Content-Type", "application/json");

  String json = "{";
  json += "\"valor\":";
  json += String(valor);
  json += ",";
  json += "\"status\":\"";
  json += status;
  json += "\",";
  json += "\"online\":true,";
  json += "\"ultima_atualizacao\":\"";
  json += getDataHora();
  json += "\",";
  json += "\"timestamp\":";
  json += String(getTimestamp());
  json += "}";

  int codigo = https.PUT(json);

  if (codigo == 401) {

    https.end();
    invalidarFirebaseAuth();

    if (autenticarFirebase()) {

      WiFiClientSecure retryClient;
      retryClient.setInsecure();

      HTTPClient retryHttps;

      String retryUrl = urlFirebaseAutenticada("/chuva");

      if (retryHttps.begin(retryClient, retryUrl)) {
        retryHttps.addHeader("Content-Type", "application/json");
        codigo = retryHttps.PUT(json);
        retryHttps.end();
      }
    }
  }

  Serial.print("Chuva Firebase: HTTP ");
  Serial.println(codigo);

  https.end();
}

// ======================================================
// HISTORICO DE CHUVA
// ======================================================

bool salvarHistoricoChuva(int valor, const String& status) {

  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  if (!garantirFirebaseAuth()) {
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;

  String url = urlFirebaseAutenticada("/historico/chuva");

  if (!https.begin(client, url)) {
    return false;
  }

  https.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["valor"] = valor;
  doc["status"] = status;
  doc["data_hora"] = getDataHora();
  doc["timestamp"] = getTimestamp();

  String json;
  serializeJson(doc, json);

  int codigo = https.POST(json);

  if (codigo == 401) {
    https.end();
    invalidarFirebaseAuth();

    if (autenticarFirebase()) {
      WiFiClientSecure retryClient;
      retryClient.setInsecure();
      HTTPClient retryHttps;
      String retryUrl = urlFirebaseAutenticada("/historico/chuva");

      if (retryHttps.begin(retryClient, retryUrl)) {
        retryHttps.addHeader("Content-Type", "application/json");
        codigo = retryHttps.POST(json);
        retryHttps.end();
      }
    }
  }

  Serial.print("Historico chuva: HTTP ");
  Serial.println(codigo);
  https.end();

  return codigo >= 200 && codigo < 300;
}

void enviarChuvaIndisponivel() {

  if (WiFi.status() != WL_CONNECTED || !garantirFirebaseAuth()) {
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;
  String url = urlFirebaseAutenticada("/chuva");

  if (!https.begin(client, url)) {
    return;
  }

  https.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["status"] = "indisponivel";
  doc["online"] = false;
  doc["ultima_atualizacao"] = getDataHora();
  doc["timestamp"] = getTimestamp();

  String json;
  serializeJson(doc, json);
  https.PUT(json);
  https.end();
}

// ======================================================
// HISTORICO DE CONEXAO DO ESP32
// ======================================================

bool registrarEventoEsp32(const String& status, long timestampEvento, const String& origem) {

  if (WiFi.status() != WL_CONNECTED || timestampEvento <= 0) {
    return false;
  }

  if (!garantirFirebaseAuth()) {
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;
  String url = urlFirebaseAutenticada("/historico/esp32");

  if (!https.begin(client, url)) {
    return false;
  }

  https.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["status"] = status;
  doc["online"] = status == "online";
  doc["origem"] = origem;
  doc["data_hora"] = formatarDataHoraTimestamp(timestampEvento);
  doc["timestamp"] = timestampEvento;

  String json;
  serializeJson(doc, json);

  int codigo = https.POST(json);

  if (codigo == 401) {
    https.end();
    invalidarFirebaseAuth();

    if (autenticarFirebase()) {
      WiFiClientSecure retryClient;
      retryClient.setInsecure();
      HTTPClient retryHttps;
      String retryUrl = urlFirebaseAutenticada("/historico/esp32");

      if (retryHttps.begin(retryClient, retryUrl)) {
        retryHttps.addHeader("Content-Type", "application/json");
        codigo = retryHttps.POST(json);
        retryHttps.end();
      }
    }
  }

  Serial.print("Historico ESP32 ");
  Serial.print(status);
  Serial.print(": HTTP ");
  Serial.println(codigo);
  https.end();

  return codigo >= 200 && codigo < 300;
}

long obterTimestampHeartbeatAnterior() {

  if (WiFi.status() != WL_CONNECTED || !garantirFirebaseAuth()) {
    return 0;
  }

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;
  String url = urlFirebaseAutenticada("/sistema/esp32");

  if (!https.begin(client, url)) {
    return 0;
  }

  int codigo = https.GET();
  if (codigo < 200 || codigo >= 300) {
    https.end();
    return 0;
  }

  String corpo = https.getString();
  https.end();

  JsonDocument doc;
  DeserializationError erro = deserializeJson(doc, corpo);
  if (erro) {
    return 0;
  }

  return doc["timestamp"] | 0L;
}

void registrarRetornoDaConexao() {

  if (timestampQuedaPendente <= 0 || WiFi.status() != WL_CONNECTED) {
    return;
  }

  long agora = getTimestamp();
  long inicioQueda = timestampQuedaPendente;

  registrarEventoEsp32("offline", inicioQueda, "wifi");
  registrarEventoEsp32("online", agora, "wifi");

  timestampQuedaPendente = 0;

  // Aviso no Telegram (so se a queda foi longa o bastante).
  long duracao = agora - inicioQueda;

  if (agora > 0 && duracao >= MIN_OFFLINE_AVISO_S) {
    enfileirarTelegram(
      "🔌 Conexão restabelecida\n"
      "Ficou offline por " + formatarDuracao(duracao) + "\n"
      "De " + formatarDataHoraTimestamp(inicioQueda) +
      " até " + formatarDataHoraTimestamp(agora) + "\n"
      "(pode ter sido queda de energia ou do roteador)"
    );
  }
}

// ======================================================
// WIFI - MULTIPLAS REDES / RECONEXAO AUTOMATICA
// ======================================================

bool tentarConectarWiFi(int indice, unsigned long tempoMaximo = 6000) {

  if (indice < 0 || indice >= TOTAL_REDES_WIFI) {
    return false;
  }

  Serial.println();
  Serial.print("Tentando Wi-Fi: ");
  Serial.println(REDES_WIFI[indice].ssid);

  WiFi.disconnect();
  delay(100);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);

  WiFi.begin(REDES_WIFI[indice].ssid, REDES_WIFI[indice].senha);

  unsigned long inicio = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - inicio < tempoMaximo) {
    delay(250);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {

    redeWiFiAtual = indice;
    proximaRedeWiFi = (indice + 1) % TOTAL_REDES_WIFI;

    Serial.print("WI-FI CONECTADO: ");
    Serial.println(REDES_WIFI[indice].ssid);

    Serial.print("IP: ");
    Serial.println(WiFi.localIP());

    return true;
  }

  Serial.print("Rede indisponivel: ");
  Serial.println(REDES_WIFI[indice].ssid);

  return false;
}

void conectarWiFiInicial() {

  Serial.println("Procurando redes Wi-Fi...");

  while (WiFi.status() != WL_CONNECTED) {

    for (int i = 0; i < TOTAL_REDES_WIFI; i++) {

      if (tentarConectarWiFi(i)) {
        ultimaTentativaWiFi = millis();
        return;
      }
    }

    Serial.println("Nenhuma rede disponivel. Nova tentativa em 5 segundos...");

    delay(5000);
  }
}

void manterWiFi() {

  if (WiFi.status() == WL_CONNECTED) {

    if (!wifiEstavaConectado) {
      wifiEstavaConectado = true;
      registrarRetornoDaConexao();
    }

    if (redeWiFiAtual < 0 || WiFi.SSID() != REDES_WIFI[redeWiFiAtual].ssid) {

      for (int i = 0; i < TOTAL_REDES_WIFI; i++) {

        if (WiFi.SSID() == REDES_WIFI[i].ssid) {
          redeWiFiAtual = i;
          proximaRedeWiFi = (i + 1) % TOTAL_REDES_WIFI;
          break;
        }
      }
    }

    return;
  }

  if (wifiEstavaConectado) {
    wifiEstavaConectado = false;
    if (timestampQuedaPendente <= 0) {
      timestampQuedaPendente = getTimestamp();
      Serial.print("Queda de Wi-Fi detectada em: ");
      Serial.println(formatarDataHoraTimestamp(timestampQuedaPendente));
    }
  }

  unsigned long agora = millis();

  if (agora - ultimaTentativaWiFi < INTERVALO_RECONEXAO_WIFI) {
    return;
  }

  ultimaTentativaWiFi = agora;

  Serial.println();
  Serial.println("Wi-Fi desconectado. Tentando outra rede...");

  int indice = proximaRedeWiFi;

  proximaRedeWiFi = (proximaRedeWiFi + 1) % TOTAL_REDES_WIFI;

  tentarConectarWiFi(indice, 5000);
}

// ======================================================
// FIREBASE - HEARTBEAT DO ESP32
// ======================================================

void enviarHeartbeat() {

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;

  if (!garantirFirebaseAuth()) {
    return;
  }

  String url = urlFirebaseAutenticada("/sistema/esp32");

  https.begin(client, url);
  https.addHeader("Content-Type", "application/json");

  String json = "{";
  json += "\"online\":true,";
  json += "\"ip\":\"";
  json += WiFi.localIP().toString();
  json += "\",";
  json += "\"rssi\":";
  json += String(WiFi.RSSI());
  json += ",";
  json += "\"uptime_segundos\":";
  json += String(millis() / 1000UL);
  json += ",";
  json += "\"ultima_atualizacao\":\"";
  json += getDataHora();
  json += "\",";
  json += "\"timestamp\":";
  json += String(getTimestamp());
  json += "}";

  int codigo = https.PUT(json);

  if (codigo == 401) {

    https.end();
    invalidarFirebaseAuth();

    if (autenticarFirebase()) {

      WiFiClientSecure retryClient;
      retryClient.setInsecure();

      HTTPClient retryHttps;

      String retryUrl = urlFirebaseAutenticada("/sistema/esp32");

      if (retryHttps.begin(retryClient, retryUrl)) {
        retryHttps.addHeader("Content-Type", "application/json");
        codigo = retryHttps.PUT(json);
        retryHttps.end();
      }
    }
  }

  Serial.print("Heartbeat ESP32: HTTP ");
  Serial.println(codigo);

  https.end();
}

// ======================================================
// CONFIGURACAO REMOTA DAS CAIXAS (PELO SITE)
// ======================================================
// A pagina config.html grava em /config os valores de cada caixa:
// capacidade, cheia, vazia e instalada. O ESP32 confere a cada 60 s,
// valida, aplica e guarda na memoria flash. Sem internet, continua
// com o ultimo valor salvo. Os valores do vetor caixas[] la em cima
// servem so como ponto de partida (primeira vez que o ESP32 liga).
// Depois que o site enviar uma configuracao, ela passa a valer no
// lugar dos valores do codigo.

Preferences prefs;

const unsigned long INTERVALO_CONFIG_MS = 60000UL;
unsigned long ultimaChecagemConfig = 0;
long configVersaoAplicada = 0;   // /config/atualizado_em ja aplicado
bool configPublicada = false;    // ja informou ao Firebase o que esta usando?

bool configValida(float capacidade, float cheia, float vazia) {
  if (!(capacidade >= 1.0f && capacidade <= 100000.0f)) return false;
  if (!(cheia >= 20.0f && cheia <= 390.0f)) return false;
  if (!(vazia <= 400.0f && vazia >= cheia + 10.0f)) return false;
  return true;
}

void salvarConfigLocal() {

  if (!prefs.begin("caixas", false)) {
    Serial.println("Config local: nao foi possivel gravar na flash");
    return;
  }

  for (int i = 0; i < TOTAL_CAIXAS; i++) {
    String k = "c" + String(caixas[i].numero);
    prefs.putFloat((k + "cap").c_str(), caixas[i].capacidade);
    prefs.putFloat((k + "ch").c_str(), caixas[i].cheia);
    prefs.putFloat((k + "va").c_str(), caixas[i].vazia);
    prefs.putBool((k + "in").c_str(), caixas[i].instalada);
  }

  prefs.putLong("versao", configVersaoAplicada);
  prefs.putBool("salvo", true);
  prefs.end();

  Serial.println("Config local: salva na flash");
}

void carregarConfigLocal() {

  if (!prefs.begin("caixas", false)) {
    Serial.println("Config local: flash indisponivel (usando valores do codigo)");
    return;
  }

  if (!prefs.getBool("salvo", false)) {
    prefs.end();
    Serial.println("Config local: nada salvo ainda (usando valores do codigo)");
    return;
  }

  configVersaoAplicada = prefs.getLong("versao", 0);

  for (int i = 0; i < TOTAL_CAIXAS; i++) {
    String k = "c" + String(caixas[i].numero);

    float cap = prefs.getFloat((k + "cap").c_str(), caixas[i].capacidade);
    float cheia = prefs.getFloat((k + "ch").c_str(), caixas[i].cheia);
    float vazia = prefs.getFloat((k + "va").c_str(), caixas[i].vazia);
    bool inst = prefs.getBool((k + "in").c_str(), caixas[i].instalada);

    if (configValida(cap, cheia, vazia)) {
      caixas[i].capacidade = cap;
      caixas[i].cheia = cheia;
      caixas[i].vazia = vazia;
      caixas[i].instalada = inst;
    }

    Serial.printf(
      "Config local %s: %.0f L | cheia %.1f cm | vazia %.1f cm | %s\n",
      caixas[i].nome,
      caixas[i].capacidade,
      caixas[i].cheia,
      caixas[i].vazia,
      caixas[i].instalada ? "instalada" : "sem sensor"
    );
  }

  prefs.end();
}

// GET (put = false) ou PUT (put = true) no Firebase, com novo login se o
// token expirar. Devolve o codigo HTTP (ou -1 se nao deu para tentar).
int firebaseRequisicao(bool put, const String& caminho, const String& corpo, String& resposta) {

  resposta = "";

  if (WiFi.status() != WL_CONNECTED) {
    return -1;
  }

  if (!garantirFirebaseAuth()) {
    return -1;
  }

  int codigo = -1;

  for (int tentativa = 0; tentativa < 2; tentativa++) {

    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient https;

    if (!https.begin(client, urlFirebaseAutenticada(caminho))) {
      return -1;
    }

    https.setTimeout(8000);

    if (put) {
      https.addHeader("Content-Type", "application/json");
      codigo = https.PUT(corpo);
    } else {
      codigo = https.GET();
    }

    if (codigo > 0) {
      resposta = https.getString();
    }

    https.end();

    if (codigo == 401 && tentativa == 0) {
      invalidarFirebaseAuth();

      if (!autenticarFirebase()) {
        return codigo;
      }

      continue;
    }

    break;
  }

  return codigo;
}

// Informa ao site o que o ESP32 esta usando (e qual versao da config).
bool publicarConfigAplicada() {

  JsonDocument doc;

  doc["atualizado_em"] = configVersaoAplicada;
  doc["timestamp"] = getTimestamp();
  doc["ultima_atualizacao"] = getDataHora();

  for (int i = 0; i < TOTAL_CAIXAS; i++) {
    String chave = "caixa" + String(caixas[i].numero);
    JsonObject o = doc["caixas"][chave].to<JsonObject>();
    o["capacidade"] = caixas[i].capacidade;
    o["cheia"] = caixas[i].cheia;
    o["vazia"] = caixas[i].vazia;
    o["instalada"] = caixas[i].instalada;
  }

  String json;
  serializeJson(doc, json);

  String resposta;
  int codigo = firebaseRequisicao(true, "/sistema/config_aplicada", json, resposta);

  Serial.print("Config aplicada -> Firebase: HTTP ");
  Serial.println(codigo);

  return codigo == 200;
}

// Faz o painel mostrar "SENSOR NAO INSTALADO" em vez de "offline".
void marcarCaixaNaoInstalada(const CaixaConfig& caixa) {

  JsonDocument doc;

  doc["nome"] = caixa.nome;
  doc["instalado"] = false;
  doc["capacidade_litros"] = caixa.capacidade;

  String json;
  serializeJson(doc, json);

  String resposta;
  int codigo = firebaseRequisicao(
    true,
    "/caixas/caixa" + String(caixa.numero),
    json,
    resposta
  );

  Serial.print(caixa.nome);
  Serial.print(" marcada como nao instalada: HTTP ");
  Serial.println(codigo);
}

bool consultarConfigRemota() {

  String resposta;
  int codigo = firebaseRequisicao(false, "/config", "", resposta);

  if (codigo != 200) {
    Serial.printf("Config remota: HTTP %d (mantendo valores atuais)\n", codigo);
    return false;
  }

  bool mudou = false;
  bool virouNaoInstalada[TOTAL_CAIXAS] = { false };
  long versao = configVersaoAplicada;

  // "null" = nada configurado ainda no Firebase.
  if (resposta != "null") {

    JsonDocument doc;
    DeserializationError erro = deserializeJson(doc, resposta);

    if (erro) {
      Serial.print("Config remota: JSON invalido: ");
      Serial.println(erro.c_str());
      return false;
    }

    versao = doc["atualizado_em"] | 0L;

    JsonObject caixasJson = doc["caixas"].as<JsonObject>();

    if (!caixasJson.isNull()) {

      for (int i = 0; i < TOTAL_CAIXAS; i++) {

        String chave = "caixa" + String(caixas[i].numero);
        JsonObject c = caixasJson[chave].as<JsonObject>();

        if (c.isNull()) {
          continue;
        }

        float cap = c["capacidade"] | caixas[i].capacidade;
        float cheia = c["cheia"] | caixas[i].cheia;
        float vazia = c["vazia"] | caixas[i].vazia;
        bool inst = c["instalada"] | caixas[i].instalada;

        if (!configValida(cap, cheia, vazia)) {
          Serial.printf("Config remota: valores invalidos para %s (ignorados)\n", caixas[i].nome);
          continue;
        }

        if (cap == caixas[i].capacidade &&
            cheia == caixas[i].cheia &&
            vazia == caixas[i].vazia &&
            inst == caixas[i].instalada) {
          continue;
        }

        if (caixas[i].instalada && !inst) {
          virouNaoInstalada[i] = true;
        }

        // Sensor passou a ser lido de novo: recomeca o filtro de oscilacao.
        if (!caixas[i].instalada && inst && caixas[i].numero == 1) {
          filtroCaixa1.inicializado = false;
        }

        caixas[i].capacidade = cap;
        caixas[i].cheia = cheia;
        caixas[i].vazia = vazia;
        caixas[i].instalada = inst;
        mudou = true;

        Serial.printf(
          "Config remota aplicada em %s: %.0f L | cheia %.1f cm | vazia %.1f cm | %s\n",
          caixas[i].nome,
          cap,
          cheia,
          vazia,
          inst ? "instalada" : "sem sensor"
        );
      }
    }
  }

  bool primeira = !configPublicada;
  bool versaoMudou = (versao != configVersaoAplicada);

  if (mudou || versaoMudou) {
    configVersaoAplicada = versao;
    salvarConfigLocal();
  }

  if (mudou || versaoMudou || primeira) {
    configPublicada = publicarConfigAplicada();
  }

  for (int i = 0; i < TOTAL_CAIXAS; i++) {
    if (!caixas[i].instalada && (primeira || virouNaoInstalada[i])) {
      marcarCaixaNaoInstalada(caixas[i]);
    }
  }

  return true;
}

void verificarConfigRemota() {

  unsigned long agora = millis();

  if (ultimaChecagemConfig != 0 && agora - ultimaChecagemConfig < INTERVALO_CONFIG_MS) {
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  ultimaChecagemConfig = (agora == 0) ? 1 : agora;
  consultarConfigRemota();
}

// ======================================================
// BATERIA DO UPS (divisor 100k + 10k no GPIO 1)
// ======================================================
// Média móvel das últimas 6 leituras de carga (30 segundos)
const int AMOSTRAS_MEDIA_CARGA_BATERIA = 6;

int historicoCargaBateria[AMOSTRAS_MEDIA_CARGA_BATERIA] = {0};
int indiceCargaBateria = 0;
int quantidadeCargaBateria = 0;
const float R1_BAT = 100000.0;
const float R2_BAT = 10000.0;
const float CALIB_BAT = 1.03;
const float TENSAO_MINIMA_BATERIA = 2.5;
bool ultimoPresenteBateria = true;

// Filtro exponencial para reduzir oscilacoes rapidas da tensao da bateria
const float ALPHA_FILTRO_BATERIA = 0.20f;
float tensaoBateriaFiltrada = 0.0f;
bool filtroBateriaInicializado = false;

const unsigned long INTERVALO_LEITURA_BATERIA = 5000;
const unsigned long INTERVALO_ENVIO_BATERIA = 60000;

unsigned long ultimaLeituraBateria = 0;
unsigned long ultimoEnvioBateria = 0;


float lerTensaoBateria() {

  uint32_t soma = 0;

  for (int i = 0; i < 30; i++) {
    soma += analogReadMilliVolts(PIN_BAT);
    delay(5);
  }

  float tensaoGPIO = (soma / 30.0f) / 1000.0f;

  float tensaoMedida =
    tensaoGPIO *
    ((R1_BAT + R2_BAT) / R2_BAT) *
    CALIB_BAT;

  // Se a bateria nao estiver presente, reseta o filtro imediatamente.
  if (tensaoMedida < TENSAO_MINIMA_BATERIA) {
    filtroBateriaInicializado = false;
    tensaoBateriaFiltrada = 0.0f;
    return tensaoMedida;
  }

  // Primeira leitura valida: inicializa o filtro corretamente.
  if (!filtroBateriaInicializado) {
    tensaoBateriaFiltrada = tensaoMedida;
    filtroBateriaInicializado = true;
  } else {
    // Aplica o filtro exponencial para suavizar a tensao
    tensaoBateriaFiltrada +=
      ALPHA_FILTRO_BATERIA *
      (tensaoMedida - tensaoBateriaFiltrada);
  }

  return tensaoBateriaFiltrada;
}



int calcularCargaBateria(float tensao) {
  const float v[] = {
    3.30, 3.50, 3.65, 3.75,
    3.85, 3.95, 4.10, 4.20
  };

  const int p[] = {
    0, 5, 15, 30, 50, 70, 90, 100
  };

  const int n = 8;

  if (tensao <= v[0]) return 0;
  if (tensao >= v[n - 1]) return 100;

  for (int i = 1; i < n; i++) {
    if (tensao <= v[i]) {
      float fracao =
        (tensao - v[i - 1]) / (v[i] - v[i - 1]);

      float carga =
        p[i - 1] + fracao * (p[i] - p[i - 1]);

      return (int)(carga + 0.5f);
    }
  }

  return 100;
}

int calcularMediaCargaBateria(int carga, bool presente) {

  // Se a bateria não estiver presente, limpa a média.
  if (!presente) {
    indiceCargaBateria = 0;
    quantidadeCargaBateria = 0;

    for (int i = 0; i < AMOSTRAS_MEDIA_CARGA_BATERIA; i++) {
      historicoCargaBateria[i] = 0;
    }

    return 0;
  }

  // Guarda a nova leitura.
  historicoCargaBateria[indiceCargaBateria] = carga;

  indiceCargaBateria =
    (indiceCargaBateria + 1) % AMOSTRAS_MEDIA_CARGA_BATERIA;

  if (quantidadeCargaBateria < AMOSTRAS_MEDIA_CARGA_BATERIA) {
    quantidadeCargaBateria++;
  }

  // Calcula a média das amostras disponíveis.
  int soma = 0;

  for (int i = 0; i < quantidadeCargaBateria; i++) {
    soma += historicoCargaBateria[i];
  }

  return (int)((float)soma / quantidadeCargaBateria + 0.5f);
}

void enviarBateria(float tensao, int carga, bool presente) {

  if (WiFi.status() != WL_CONNECTED || !garantirFirebaseAuth()) {
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;
  String url = urlFirebaseAutenticada("/bateria");

  if (!https.begin(client, url)) {
    return;
  }

  https.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["tensao"] = tensao;
  doc["presente"] = presente;
  if (presente) {
    doc["carga"] = carga;
  }
  doc["online"] = true;
  doc["ultima_atualizacao"] = getDataHora();
  doc["timestamp"] = getTimestamp();

  String json;
  serializeJson(doc, json);

  int codigo = https.PUT(json);

  if (codigo == 401) {
    https.end();
    invalidarFirebaseAuth();

    if (autenticarFirebase()) {
      WiFiClientSecure retryClient;
      retryClient.setInsecure();
      HTTPClient retryHttps;
      String retryUrl = urlFirebaseAutenticada("/bateria");

      if (retryHttps.begin(retryClient, retryUrl)) {
        retryHttps.addHeader("Content-Type", "application/json");
        codigo = retryHttps.PUT(json);
        retryHttps.end();
      }
    }
  }

  Serial.print("Bateria Firebase: HTTP ");
  Serial.println(codigo);
  https.end();
}

void processarBateria() {

  unsigned long agora = millis();

  if (agora - ultimaLeituraBateria < INTERVALO_LEITURA_BATERIA) {
    return;
  }

  ultimaLeituraBateria = agora;

  float tensao = lerTensaoBateria();
  bool presente = tensao >= TENSAO_MINIMA_BATERIA;
  int cargaBruta = presente ? calcularCargaBateria(tensao) : 0;

int carga = calcularMediaCargaBateria(cargaBruta, presente);

  if (presente) {
    Serial.printf("Bateria UPS: %.2f V | Carga estimada: %d%%\n", tensao, carga);
  } else {
    Serial.printf("Bateria UPS: nao detectada (%.2f V)\n", tensao);
  }

  bool mudou = (presente != ultimoPresenteBateria);

  if (mudou || ultimoEnvioBateria == 0 ||
      agora - ultimoEnvioBateria >= INTERVALO_ENVIO_BATERIA) {
    ultimoEnvioBateria = agora;
    ultimoPresenteBateria = presente;
    enviarBateria(tensao, carga, presente);
  }
}

// ======================================================
// SETUP
// ======================================================

void setup() {

  Serial.begin(115200);
  
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_BAT, ADC_0db);
  Serial.printf("Bateria ADC bruto: %d\n", analogRead(1));
Serial.printf("Bateria ADC mV: %d\n", analogReadMilliVolts(1));

  // -------------------------
  // CONFIGURACAO SALVA NA FLASH (ultima enviada pelo site)
  // -------------------------

  carregarConfigLocal();

  // -------------------------
  // CAIXAS
  // -------------------------

  for (int i = 0; i < TOTAL_CAIXAS; i++) {
    pinMode(caixas[i].trig, OUTPUT);
    pinMode(caixas[i].echo, INPUT);
    digitalWrite(caixas[i].trig, LOW);
  }

  // Sensor de chuva
  pinMode(SENSOR_CHUVA, INPUT);

  // -------------------------
  // I2C
  // -------------------------

  Wire.begin(SDA_PIN, SCL_PIN);

  Serial.println();
  Serial.println("==========================");
  Serial.println("      SITIO 4 IRMAOS");
  Serial.println(" 3 CAIXAS + CLIMA + CHUVA");
  Serial.println("==========================");

  for (int i = 0; i < TOTAL_CAIXAS; i++) {
    if (!caixas[i].instalada) {
      Serial.print(caixas[i].nome);
      Serial.println(": sensor NAO instalado (ignorada)");
    }
  }

  // -------------------------
  // AHT20
  // -------------------------

  if (aht.begin()) {
    ahtOK = true;
    Serial.println("AHT20 OK!");
  } else {
    Serial.println("AHT20 NAO ENCONTRADO");
  }

  // -------------------------
  // BMP280
  // -------------------------

  if (bmp.begin(0x77) || bmp.begin(0x76)) {
    bmpOK = true;
    Serial.println("BMP280 OK!");
  } else {
    Serial.println("BMP280 NAO ENCONTRADO");
  }

  // -------------------------
  // DS3231 (relogio)
  // -------------------------

  iniciarRTC();
  carregarHoraDoRTC();

  // -------------------------
  // WIFI
  // -------------------------

  conectarWiFiInicial();

  // -------------------------
  // HORARIO
  // -------------------------

  sincronizarHorario();

  // -------------------------
  // FIREBASE AUTH
  // -------------------------

  autenticarFirebase();

  // Pega a configuracao mais recente das caixas (enviada pelo site).
  consultarConfigRemota();
  ultimaChecagemConfig = millis();

  // Antes do primeiro heartbeat novo, consulta o último heartbeat salvo.
  // Se houver um intervalo grande (ex.: reinício/falta de energia), registra
  // uma queda aproximada a partir de 45 s após a última comunicação.
  long heartbeatAnterior = obterTimestampHeartbeatAnterior();
  long agoraOnline = getTimestamp();

  if (heartbeatAnterior > 0 && agoraOnline - heartbeatAnterior > 45) {
    registrarEventoEsp32("offline", heartbeatAnterior + 45, "heartbeat");
  }

  registrarEventoEsp32("online", agoraOnline, "inicializacao");
  wifiEstavaConectado = WiFi.status() == WL_CONNECTED;

  // -------------------------
  // TELEGRAM - aviso de inicializacao
  // -------------------------

  long intervaloSemComunicar = agoraOnline - heartbeatAnterior;

  if (heartbeatAnterior > 0 && agoraOnline > 0 &&
      intervaloSemComunicar >= MIN_OFFLINE_AVISO_S) {

    enfileirarTelegram(
      "🔌 ESP32 voltou a funcionar\n"
      "Ficou sem comunicar por " + formatarDuracao(intervaloSemComunicar) + "\n"
      "Última comunicação: " + formatarDataHoraTimestamp(heartbeatAnterior) + "\n"
      "Agora: " + formatarDataHoraTimestamp(agoraOnline) + "\n"
      "(provável queda de energia com a bateria esgotada)"
    );

  } else if (AVISAR_INICIALIZACAO) {

    enfileirarTelegram(
      "✅ Sítio 4 Irmãos online\n"
      "ESP32 iniciado em " + getDataHora()
    );
  }

  if (!SENSOR_CHUVA_INSTALADO) {
    enviarChuvaIndisponivel();
  }

  ultimaLeitura = millis() - INTERVALO_LEITURA;
  ultimoHistorico = millis() - INTERVALO_HISTORICO;
  ultimoHistoricoClima = millis() - INTERVALO_HISTORICO_CLIMA;
}

// ======================================================
// LOOP
// ======================================================

void loop() {

  manterWiFi();

  // Envia mensagens pendentes do Telegram (se houver)
  processarFilaTelegram();

  // Mantem o DS3231 acertado pelo NTP (a cada 6 h)
  manterRelogioRTC();

  // Bateria do UPS: lê a cada 5 s e envia ao Firebase a cada 60 s
  processarBateria();

  // Confere a cada 60 s se o site enviou novas medidas das caixas
  verificarConfigRemota();

  unsigned long agora = millis();

  if (agora - ultimaLeitura < INTERVALO_LEITURA) {
    return;
  }

  ultimaLeitura = agora;

  bool deveSalvarHistorico = agora - ultimoHistorico >= INTERVALO_HISTORICO;

  if (deveSalvarHistorico) {
    ultimoHistorico = agora;
  }

  // ==================================================
  // 3 CAIXAS
  // ==================================================

  for (int i = 0; i < TOTAL_CAIXAS; i++) {

    // Pula as caixas sem sensor (tambem evita o delay abaixo).
    if (!caixas[i].instalada) {
      continue;
    }

    processarCaixa(caixas[i], deveSalvarHistorico);

    // Pequeno intervalo para evitar interferencia
    // entre sensores ultrassonicos.
    delay(250);
  }

  // ==================================================
  // CLIMA
  // ==================================================

  if (ahtOK && bmpOK) {

    sensors_event_t umidadeEvento;
    sensors_event_t temperaturaEvento;

    aht.getEvent(&umidadeEvento, &temperaturaEvento);

    float temperatura = temperaturaEvento.temperature;
    float umidade = umidadeEvento.relative_humidity;
    float pressao = bmp.readPressure() / 100.0F;

    Serial.println();
    Serial.println("CLIMA");

    Serial.print("Temperatura: ");
    Serial.print(temperatura, 1);
    Serial.println(" C");

    Serial.print("Umidade: ");
    Serial.print(umidade, 1);
    Serial.println(" %");

    Serial.print("Pressao: ");
    Serial.print(pressao, 1);
    Serial.println(" hPa");

    enviarClima(temperatura, umidade, pressao);

    if (agora - ultimoHistoricoClima >= INTERVALO_HISTORICO_CLIMA) {
      salvarHistoricoClima(temperatura, umidade, pressao);
      ultimoHistoricoClima = agora;
    }
  }

  // ==================================================
  // CHUVA
  // ==================================================

  if (SENSOR_CHUVA_INSTALADO) {

    int valorChuva = analogRead(SENSOR_CHUVA);
    String statusChuva = calcularStatusChuva(valorChuva);

    Serial.println();
    Serial.println("CHUVA");
    Serial.print("Valor: ");
    Serial.println(valorChuva);
    Serial.print("Status: ");
    Serial.println(statusChuva);

    enviarChuva(valorChuva, statusChuva);

    // O histórico registra somente mudanças reais de estado
    // (seco -> gotas -> chuva -> seco), evitando milhares de linhas iguais.
    if (statusChuva != ultimoStatusChuvaRegistrado) {
      if (salvarHistoricoChuva(valorChuva, statusChuva)) {
        ultimoStatusChuvaRegistrado = statusChuva;
      }
    }

  } else {

    // Enquanto o sensor estiver fisicamente desconectado, não inventa
    // "sem chuva": informa ao Firebase que o monitoramento está indisponível.
    enviarChuvaIndisponivel();
  }

  // ==================================================
  // HEARTBEAT DO ESP32
  // ==================================================

  enviarHeartbeat();
}
