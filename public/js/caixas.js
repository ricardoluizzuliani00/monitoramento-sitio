let nivelCaixa1 = 78;
let nivelCaixa2 = 43;

const capacidadeCaixa1 = 500;
const capacidadeCaixa2 = 1000;


// ========================================
// DEFINIR STATUS DA CAIXA
// ========================================

function atualizarStatus(nivel) {

    if (nivel >= 70) {

        return {
            texto: "🟢 NORMAL",
            classe: "status-normal"
        };

    }

    if (nivel >= 30) {

        return {
            texto: "🟡 ATENÇÃO",
            classe: "status-atencao"
        };

    }

    return {
        texto: "🔴 BAIXO",
        classe: "status-baixo"
    };
}


// ========================================
// ATUALIZAR CAIXA
// ========================================

function atualizarCaixa(numero, nivel, capacidade) {

    const agua =
        document.querySelector(`#agua-caixa-${numero}`);

    const percentual =
        document.querySelector(`#nivel-caixa-${numero}`);

    const litros =
        document.querySelector(`#litros-caixa-${numero}`);

    const status =
        document.querySelector(`#status-caixa-${numero}`);

    const card =
        document.querySelector(`#card-caixa-${numero}`);


    const litrosCalculados =
        capacidade * nivel / 100;


    agua.style.height =
        nivel + "%";


    percentual.textContent =
        nivel + "%";


    litros.textContent =
        litrosCalculados + " litros";


    const resultadoStatus =
        atualizarStatus(nivel);


    status.textContent =
        resultadoStatus.texto;


    card.classList.remove(
        "status-normal",
        "status-atencao",
        "status-baixo"
    );


    card.classList.add(
        resultadoStatus.classe
    );
}