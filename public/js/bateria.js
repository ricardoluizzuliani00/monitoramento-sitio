function atualizarBateria(dados) {
    const nivel = document.querySelector("#nivel-bateria");
    const tensao = document.querySelector("#tensao-bateria");
    const barra = document.querySelector("#barra-bateria");
    const status = document.querySelector("#status-bateria");

    if (!nivel || !tensao || !barra || !status) return;

    function limparBateria(mensagem) {
        nivel.textContent = "--%";
        tensao.textContent = "-- V";
        barra.style.width = "0%";
        status.textContent = mensagem;
    }

    // Sem dados válidos ou sem conexão.
    if (!dados || typeof dados !== "object" || dados.online !== true) {
        limparBateria("⚪ Sem dados da bateria");
        return;
    }

    // ESP32 informou que não há bateria conectada.
    if (dados.presente === false) {
        limparBateria("⚪ Sem bateria conectada");
        return;
    }

    // Validar os campos antes de formatar.
    const cargaBruta = dados.carga;
    const tensaoBruta = dados.tensao;

    if (
        cargaBruta === null ||
        cargaBruta === undefined ||
        tensaoBruta === null ||
        tensaoBruta === undefined ||
        String(cargaBruta).trim() === "" ||
        String(tensaoBruta).trim() === ""
    ) {
        limparBateria("⚪ Sem dados da bateria");
        return;
    }

    const cargaNumero = Number(cargaBruta);
    const tensaoNumero = Number(tensaoBruta);

    if (
        !Number.isFinite(cargaNumero) ||
        !Number.isFinite(tensaoNumero)
    ) {
        limparBateria("⚪ Sem dados da bateria");
        return;
    }

    const carga = Math.max(0, Math.min(100, cargaNumero));
    const volts = tensaoNumero;

    nivel.textContent = carga.toFixed(0) + "%";
    tensao.textContent = volts.toFixed(2) + " V";
    barra.style.width = carga + "%";

    if (carga >= 50) {
        status.textContent = "🟢 Bateria normal";
    } else if (carga >= 20) {
        status.textContent = "🟡 Bateria baixa";
    } else {
        status.textContent = "🔴 Bateria crítica";
    }
}