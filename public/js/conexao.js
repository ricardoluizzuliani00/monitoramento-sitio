// ========================================
// CONEXÃO REAL DO ESP32
// ========================================

let ultimaAtualizacao = Date.now();

setInterval(() => {

    const conexao =
        document.querySelector("#conexao");

    if (!conexao) return;

    const segundos =
        Math.floor(
            (Date.now() - ultimaAtualizacao) / 1000
        );

    if (segundos >= 30) {

        conexao.textContent =
            "🔴 ESP32 OFFLINE";

    } else {

        conexao.textContent =
            "🟢 ESP32 ONLINE";
    }

}, 1000);