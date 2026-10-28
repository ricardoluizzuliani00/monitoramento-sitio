
// ========================================
// SIMULAÇÃO DO ESP32
// ========================================

function receberDadosESP32() {

    // 💧 Níveis das caixas

    nivelCaixa1 +=
        Math.floor(Math.random() * 5) - 2;

    nivelCaixa2 +=
        Math.floor(Math.random() * 5) - 2;


    nivelCaixa1 =
        Math.max(
            0,
            Math.min(100, nivelCaixa1)
        );

    nivelCaixa2 =
        Math.max(
            0,
            Math.min(100, nivelCaixa2)
        );


    // 🌡️ Temperatura

    const temperatura =
        25 + (Math.random() * 2 - 1);


    // 💧 Umidade

    const umidade =
        68 + (Math.random() * 4 - 2);


    // 🌬️ Pressão

    const pressao =
        1013 + (Math.random() * 4 - 2);


    // 🌧️ Chuva

    const chuva =
        Math.random() > 0.8;


    // 🔋 Bateria

    // 🔋 Bateria

const tensaoBateria =
    3.7 + (Math.random() * 0.5);

const bateria =
    Math.max(
        0,
        Math.min(
            100,
            ((tensaoBateria - 3.2) / (4.2 - 3.2)) * 100
        )
    );

    // 📦 Dados enviados pelo ESP32

    return {

        caixa1: nivelCaixa1,

        caixa2: nivelCaixa2,

        temperatura: temperatura,

        umidade: umidade,

        pressao: pressao,

        chuva: chuva,

        tensaoBateria: tensaoBateria,

        bateria: bateria

    };
}

