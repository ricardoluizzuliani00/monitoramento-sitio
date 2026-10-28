console.log("Sistema Sítio 4 Irmãos iniciado!");


// =====================================================
// CONFIGURAÇÕES
// =====================================================
// =====================================================
// ATUALIZAÇÃO DO DASHBOARD
// =====================================================


function atualizarDashboard() {

    const dados =
        receberDadosESP32();


    // 💧 CAIXAS

    nivelCaixa1 =
        dados.caixa1;

    atualizarCaixa(
        1,
        nivelCaixa1,
        capacidadeCaixa1
    );


    nivelCaixa2 =
        dados.caixa2;

    atualizarCaixa(
        2,
        nivelCaixa2,
        capacidadeCaixa2
    );


   // 🌦️ CLIMA

atualizarClima(dados);


// 🔋 BATERIA

atualizarBateria(dados);

    // 🕐 ÚLTIMA ATUALIZAÇÃO

    ultimaAtualizacao =
        Date.now();

    document.querySelector("#ultima-atualizacao")
        .textContent =
        "Última atualização: agora";
}


// =====================================================
// SLIDER CAIXA 1
// =====================================================

const controleCaixa1 =
    document.querySelector("#controle-caixa-1");


controleCaixa1.addEventListener(
    "input",
    function () {

        nivelCaixa1 =
            Number(controleCaixa1.value);


        atualizarCaixa(
            1,
            nivelCaixa1,
            capacidadeCaixa1
        );

    }
);


// =====================================================
// SLIDER CAIXA 2
// =====================================================

const controleCaixa2 =
    document.querySelector("#controle-caixa-2");


controleCaixa2.addEventListener(
    "input",
    function () {

        nivelCaixa2 =
            Number(controleCaixa2.value);


        atualizarCaixa(
            2,
            nivelCaixa2,
            capacidadeCaixa2
        );

    }
);


// =====================================================
// INICIALIZAÇÃO
// =====================================================

atualizarCaixa(
    1,
    nivelCaixa1,
    capacidadeCaixa1
);

atualizarCaixa(
    2,
    nivelCaixa2,
    capacidadeCaixa2
);

atualizarConexao();

atualizarDashboard();


// =====================================================
// SIMULAÇÃO DO ESP32
// Atualiza a cada 5 segundos
// =====================================================

setInterval(
    atualizarDashboard,
    5000
);
