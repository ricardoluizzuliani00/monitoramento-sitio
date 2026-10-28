
const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

setGlobalOptions({ maxInstances: 10 });

initializeApp({
  databaseURL:
    "https://SEU_PROJETO-default-rtdb.firebaseio.com"
});

const EMAIL_ADMIN = "SEU_EMAIL_ADMIN_AQUI";

exports.resetMonitoramento = onCall(
  { region: "us-central1" },
  async (request) => {
    const usuario = request.auth;

    if (!usuario) {
      throw new HttpsError(
        "unauthenticated",
        "Faça login para executar esta operação."
      );
    }

    const email = String(
      usuario.token.email || ""
    ).toLowerCase();

    const emailVerificado =
      usuario.token.email_verified === true;

    if (
      email !== EMAIL_ADMIN ||
      !emailVerificado
    ) {
      throw new HttpsError(
        "permission-denied",
        "Conta administrativa não autorizada."
      );
    }

    const camposParaRemover = [
      "caixas/caixa1/nivel_percentual",
      "caixas/caixa1/litros",
      "caixas/caixa1/distancia_cm",
      "caixas/caixa1/status",
      "caixas/caixa1/timestamp",
      "caixas/caixa1/ultima_atualizacao",
      "caixas/caixa1/ultimaAtualizacao",

      "caixas/caixa2/nivel_percentual",
      "caixas/caixa2/litros",
      "caixas/caixa2/distancia_cm",
      "caixas/caixa2/status",
      "caixas/caixa2/timestamp",
      "caixas/caixa2/ultima_atualizacao",
      "caixas/caixa2/ultimaAtualizacao",

      "caixas/caixa3/nivel_percentual",
      "caixas/caixa3/litros",
      "caixas/caixa3/distancia_cm",
      "caixas/caixa3/status",
      "caixas/caixa3/timestamp",
      "caixas/caixa3/ultima_atualizacao",
      "caixas/caixa3/ultimaAtualizacao",

      "clima/temperatura",
      "clima/umidade",
      "clima/pressao",
      "clima/timestamp",
      "clima/ultima_atualizacao",
      "clima/ultimaAtualizacao",
      "clima/online",

      "chuva/valor",
      "chuva/status",
      "chuva/timestamp",
      "chuva/ultima_atualizacao",
      "chuva/ultimaAtualizacao",
      "chuva/online",

      "bateria/tensao",
      "bateria/carga",
      "bateria/presente",
      "bateria/online",
      "bateria/timestamp",
      "bateria/ultima_atualizacao",
      "bateria/ultimaAtualizacao",

      "historico/caixa1",
      "historico/caixa2",
      "historico/caixa3",
      "historico/clima",
      "historico/chuva",
      "historico/esp32"
    ];

    const atualizacao = {};

    for (const caminho of camposParaRemover) {
      atualizacao[caminho] = null;
    }

    
    try {
      await getDatabase().ref().update(atualizacao);

      return {
        sucesso: true,
        mensagem:
          "Reset concluído. Aguardando novas leituras."
      };
    } catch (erro) {
      console.error("Erro no reset:", erro);

      throw new HttpsError(
        "internal",
        "Não foi possível concluir o reset."
      );
    }

  }
);
