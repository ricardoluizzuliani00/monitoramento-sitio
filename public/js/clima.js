import { initializeApp } from
"https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getDatabase,
    ref,
    onValue
} from
"https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import {
    getAuth,
    signInAnonymously
} from
"https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "SUA_API_KEY_FIREBASE",
    authDomain: "SEU_PROJETO.firebaseapp.com",
    databaseURL: "https://SEU_PROJETO-default-rtdb.firebaseio.com",
    projectId: "SEU_PROJETO_FIREBASE",
    storageBucket: "SEU_PROJETO.firebasestorage.app",
    messagingSenderId: "SEU_MESSAGING_SENDER_ID",
    appId: "SEU_FIREBASE_APP_ID"
};

const app = initializeApp(firebaseConfig, "detalhesClima");
const db = getDatabase(app);
const auth = getAuth(app);

const TEMPO_OFFLINE = 45000;
let timestampClima = null;
let timestampEsp32 = null;
let historicoCompleto = [];
let periodoAtual = "24h";
let graficos = { temperatura: null, umidade: null, pressao: null };

function converterTimestamp(timestamp) {
    if (!timestamp) return null;
    let valor = Number(timestamp);
    if (!isNaN(valor)) {
        if (valor < 1000000000000) valor *= 1000;
        return valor;
    }
    const data = Date.parse(timestamp);
    return !isNaN(data) ? data : null;
}

function estaOnline(timestamp) {
    return !!timestamp && Math.abs(Date.now() - timestamp) <= TEMPO_OFFLINE;
}

function atualizarStatusEsp32() {
    const el = document.querySelector("#conexao-detalhes");
    if (el) el.textContent = estaOnline(timestampEsp32)
        ? "🟢 ESP32 ONLINE"
        : "🔴 ESP32 OFFLINE";
}

function atualizarClimaAtual(dados) {
    const online = estaOnline(timestampClima);
    const sensor = document.querySelector("#sensor-clima-detalhes");

    if (!dados || !online) {
        document.querySelector("#temperatura-detalhes").textContent = "--°C";
        document.querySelector("#umidade-detalhes").textContent = "--%";
        document.querySelector("#pressao-detalhes").textContent = "---- hPa";
        if (sensor) sensor.textContent = "🔴 Offline";
        return;
    }

    document.querySelector("#temperatura-detalhes").textContent =
        Number(dados.temperatura).toFixed(1) + "°C";
    document.querySelector("#umidade-detalhes").textContent =
        Number(dados.umidade).toFixed(1) + "%";
    document.querySelector("#pressao-detalhes").textContent =
        Number(dados.pressao).toFixed(1) + " hPa";

    const atualizacao = document.querySelector("#atualizacao-detalhes");
    if (atualizacao) {
        atualizacao.textContent =
            dados.data_hora || dados.ultima_atualizacao || "--";
    }

    if (sensor) sensor.textContent = "🟢 Ativo";
}

function atualizarChuva(dados) {
    const el = document.querySelector("#chuva-detalhes");
    if (!el) return;
    const status = String(dados?.status || "").toLowerCase();
    if (status === "seco") el.textContent = "☀️ Sem chuva";
    else if (status === "gotas") el.textContent = "💧 Gotas detectadas";
    else if (status === "chuva") el.textContent = "🌧️ Chuva detectada";
    else el.textContent = "⚪ Sem dados";
}

function filtrarHistorico() {
    const agora = Math.floor(Date.now() / 1000);
    const segundos = periodoAtual === "24h"
        ? 86400
        : periodoAtual === "7d"
            ? 604800
            : 2592000;
    return historicoCompleto.filter(item => item.timestamp >= agora - segundos);
}

function labelsDoPeriodo(dados) {
    return dados.map(item => {
        const data = new Date(item.timestamp * 1000);
        if (periodoAtual === "24h") {
            return data.toLocaleTimeString("pt-BR", {
                hour: "2-digit", minute: "2-digit"
            });
        }
        return data.toLocaleDateString("pt-BR", {
            day: "2-digit", month: "2-digit"
        });
    });
}

function atualizarFaixa(id, valores, unidade, casas = 1) {
    const el = document.querySelector(id);
    if (!el) return;
    if (!valores.length) {
        el.textContent = "--";
        return;
    }
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    el.textContent =
        `${min.toFixed(casas)}${unidade} – ${max.toFixed(casas)}${unidade}`;
}

function criarGrafico(chave, canvasId, labels, valores, label, unidade) {
    if (graficos[chave]) graficos[chave].destroy();

    const canvas = document.querySelector(canvasId);
    if (!canvas) return;

    graficos[chave] = new Chart(canvas, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label,
                data: valores,
                borderWidth: 3,
                tension: 0.35,
                fill: true,
                pointRadius: valores.length > 40 ? 0 : 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: "index"
            },
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: periodoAtual === "24h" ? 8 : 10
                    },
                    grid: {
                        color: "rgba(255, 255, 255, 0.06)"
                    }
                },
                y: {
                    ticks: {
                        callback: value => value + unidade
                    },
                    grid: {
                        color: "rgba(255, 255, 255, 0.10)"
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context =>
                            ` ${label}: ${Number(context.parsed.y).toFixed(1)}${unidade}`
                    }
                }
            }
        }
    });
}

function atualizarGraficos() {
    const dados = filtrarHistorico();
    const mensagem = document.querySelector("#sem-historico");

    if (!dados.length) {
        if (mensagem) {
            mensagem.style.display = "block";
            mensagem.textContent =
                periodoAtual === "24h"
                    ? "Sem dados nas últimas 24 horas."
                    : periodoAtual === "7d"
                        ? "Sem dados nos últimos 7 dias."
                        : "Sem dados nos últimos 30 dias.";
        }
        Object.values(graficos).forEach(g => g?.destroy());
        graficos = { temperatura: null, umidade: null, pressao: null };
        atualizarFaixa("#faixa-temperatura", [], "°C");
        atualizarFaixa("#faixa-umidade", [], "%");
        atualizarFaixa("#faixa-pressao", [], " hPa");
        return;
    }

    if (mensagem) {
        mensagem.style.display = "none";
        mensagem.textContent = "";
    }

    const labels = labelsDoPeriodo(dados);
    const temperaturas = dados.map(d => d.temperatura);
    const umidades = dados.map(d => d.umidade);
    const pressoes = dados.map(d => d.pressao);

    atualizarFaixa("#faixa-temperatura", temperaturas, "°C");
    atualizarFaixa("#faixa-umidade", umidades, "%");
    atualizarFaixa("#faixa-pressao", pressoes, " hPa");

    criarGrafico("temperatura", "#graficoTemperatura", labels, temperaturas, "Temperatura", "°C");
    criarGrafico("umidade", "#graficoUmidade", labels, umidades, "Umidade", "%");
    criarGrafico("pressao", "#graficoPressao", labels, pressoes, "Pressão", " hPa");
}

signInAnonymously(auth)
    .then(() => {
        console.log("🔐 Detalhes do clima autenticados anonimamente");

        onValue(ref(db, "sistema/esp32"), snapshot => {
            const dados = snapshot.val();
            timestampEsp32 = dados
                ? converterTimestamp(
                    dados.timestamp ??
                    dados.ultima_atualizacao ??
                    dados.ultimaAtualizacao
                )
                : null;
            atualizarStatusEsp32();
        });

        onValue(ref(db, "clima"), snapshot => {
            const dados = snapshot.val();
            timestampClima = dados
                ? converterTimestamp(
                    dados.timestamp ??
                    dados.ultima_atualizacao ??
                    dados.ultimaAtualizacao
                )
                : null;
            atualizarClimaAtual(dados);
        });

        onValue(ref(db, "chuva"), snapshot => {
            atualizarChuva(snapshot.val());
        });

        onValue(ref(db, "historico/clima"), snapshot => {
            historicoCompleto = [];

            snapshot.forEach(item => {
                const dados = item.val();
                const timestamp = Number(dados?.timestamp);
                const temperatura = Number(dados?.temperatura);
                const umidade = Number(dados?.umidade);
                const pressao = Number(dados?.pressao);

                if (
                    Number.isFinite(timestamp) &&
                    Number.isFinite(temperatura) &&
                    Number.isFinite(umidade) &&
                    Number.isFinite(pressao)
                ) {
                    historicoCompleto.push({
                        timestamp,
                        temperatura,
                        umidade,
                        pressao
                    });
                }
            });

            historicoCompleto.sort((a, b) => a.timestamp - b.timestamp);
            atualizarGraficos();
        });

        document.querySelectorAll(".filtro").forEach(botao => {
            botao.addEventListener("click", () => {
                document.querySelectorAll(".filtro").forEach(b =>
                    b.classList.remove("ativo")
                );
                botao.classList.add("ativo");
                periodoAtual = botao.dataset.periodo;
                atualizarGraficos();
            });
        });

        setInterval(() => {
            atualizarStatusEsp32();
        }, 5000);
    })
    .catch(erro => {
        console.error("❌ Erro na autenticação do clima:", erro);
        const el = document.querySelector("#conexao-detalhes");
        if (el) el.textContent = "🔴 Erro de autenticação";
    });
