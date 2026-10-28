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


// ======================================================
// SÍTIO 4 IRMÃOS
// FIREBASE + STATUS ESP32 + TODOS OS SENSORES
// ======================================================

console.log("🔥 firebase-sync.js carregado");


// ======================================================
// FIREBASE
// ======================================================

const firebaseConfig = {

    apiKey: "SUA_API_KEY_FIREBASE",

    authDomain:
        "SEU_PROJETO.firebaseapp.com",

    databaseURL:
        "https://SEU_PROJETO-default-rtdb.firebaseio.com",

    projectId:
        "SEU_PROJETO_FIREBASE",

    storageBucket:
        "SEU_PROJETO.firebasestorage.app",

    messagingSenderId:
        "SEU_MESSAGING_SENDER_ID",

    appId:
        "SEU_FIREBASE_APP_ID"
};


const app =
    initializeApp(firebaseConfig);

const db =
    getDatabase(app);

const auth =
    getAuth(app);


console.log("🔥 Firebase inicializado");


// ======================================================
// AUTENTICAÇÃO ANÔNIMA DO PWA
// ======================================================

signInAnonymously(auth)
    .then(() => {

        console.log("🔐 PWA autenticado anonimamente");

        // ======================================================
        // CONFIGURAÇÕES
        // ======================================================


        // ESP32 envia dados aproximadamente
        // a cada 10 segundos.
        //
        // Se ficar 30 segundos sem atualização,
        // consideramos offline.

        const TEMPO_OFFLINE = 30000;


        // Guarda o último timestamp
        // recebido de cada parte do sistema.

        const timestamps = {

            caixa1: null,
            caixa2: null,
            caixa3: null,

            clima: null,

            chuva: null
        };


        // ======================================================
        // FUNÇÕES AUXILIARES
        // ======================================================


        function converterTimestamp(timestamp) {

            if (!timestamp) {
                return null;
            }


            if (!isNaN(timestamp)) {

                let valor =
                    Number(timestamp);


                // ESP32 envia timestamp Unix
                // em segundos.
                //
                // JavaScript trabalha
                // em milissegundos.

                if (
                    valor <
                    1000000000000
                ) {

                    valor *= 1000;
                }


                return valor;
            }


            const data =
                Date.parse(timestamp);


            if (!isNaN(data)) {

                return data;
            }


            return null;
        }


        // ------------------------------------------------------


        function pegarTimestamp(dados) {

            if (!dados) {
                return null;
            }


            return converterTimestamp(

                dados.timestamp ??

                dados.ultima_atualizacao ??

                dados.ultimaAtualizacao

            );
        }


        // ------------------------------------------------------


        function estaOnline(timestamp) {

            if (!timestamp) {
                return false;
            }


            return (

                Date.now() -
                timestamp

            ) <= TEMPO_OFFLINE;
        }


        // ------------------------------------------------------


        function tempoDesdeAtualizacao(timestamp) {

            if (!timestamp) {

                return "Sem atualização";
            }


            const diferenca =
                Math.max(
                    0,
                    Date.now() - timestamp
                );


            const segundos =
                Math.floor(
                    diferenca / 1000
                );


            if (segundos < 60) {

                return "agora";
            }


            const minutos =
                Math.floor(
                    segundos / 60
                );


            if (minutos < 60) {

                return `há ${minutos} min`;
            }


            const horas =
                Math.floor(
                    minutos / 60
                );


            if (horas < 24) {

                return `há ${horas} h`;
            }


            const dias =
                Math.floor(
                    horas / 24
                );


            return (
                `há ${dias} dia` +
                (dias > 1 ? "s" : "")
            );
        }


        // ======================================================
        // STATUS GERAL DO ESP32
        // ======================================================


        function verificarStatusEsp32() {

            const statusEl =

                document.querySelector(
                    "#status-conexao"
                ) ||

                document.querySelector(
                    "#status-esp32"
                );


            const ultimaEl =

                document.querySelector(
                    "#ultima-atualizacao"
                );


            // Procura o timestamp mais recente
            // de todo o sistema.

            const validos =
                Object.values(timestamps)
                    .filter(
                        valor =>
                            valor !== null
                    );


            let ultimoTimestamp = null;


            if (validos.length > 0) {

                ultimoTimestamp =
                    Math.max(...validos);
            }


            const online =
                estaOnline(
                    ultimoTimestamp
                );


            if (statusEl) {

                if (online) {

                    statusEl.textContent =
                        "🟢 ESP32 Online";

                } else {

                    statusEl.textContent =
                        "🔴 ESP32 Offline";
                }
            }


            if (ultimaEl) {

                ultimaEl.textContent =
                    "Última atualização: " +
                    tempoDesdeAtualizacao(
                        ultimoTimestamp
                    );
            }
        }


        // ======================================================
        // TAG SENSOR DAS CAIXAS
        // ======================================================


        function pegarTagSensor(numero) {

            /*
                Como seu HTML usa:

                <div class="tag-sensor ativo">

                sem ID individual,

                pegamos as tags pela ordem:

                0 = Caixa 1
                1 = Caixa 2
                2 = Caixa 3
            */

            const tags =
                document.querySelectorAll(
                    ".tag-sensor"
                );


            return (
                tags[numero - 1] ||
                null
            );
        }


        // ======================================================
        // ATUALIZA VISUAL DAS CAIXAS
        // ======================================================


        function atualizarCaixaOffline(
            numero
        ) {

            const nivelEl =
                document.querySelector(
                    `#nivel-caixa-${numero}`
                );


            const litrosEl =
                document.querySelector(
                    `#litros-caixa-${numero}`
                );


            const aguaEl =
                document.querySelector(
                    `#agua-caixa-${numero}`
                );


            const statusEl =
                document.querySelector(
                    `#status-caixa-${numero}`
                );


            const sensorEl =
                pegarTagSensor(numero);


            if (sensorEl) {

                sensorEl.textContent =
                    "● SENSOR OFFLINE";


                sensorEl.classList.remove(
                    "ativo"
                );


                sensorEl.classList.add(
                    "offline"
                );
            }


            if (nivelEl) {

                nivelEl.textContent =
                    "--%";
            }


            if (litrosEl) {

                litrosEl.textContent =
                    "💧 -- litros";
            }


            if (aguaEl) {

                aguaEl.style.height =
                    "0%";
            }


            if (statusEl) {

                statusEl.textContent =
                    "⚪ Sem dados recentes";
            }
        }


        // ------------------------------------------------------


        function atualizarCaixaOnline(
            numero,
            dados
        ) {

            const nivel =
                Number(
                    dados.nivel_percentual
                );


            const litros =
                Number(
                    dados.litros
                );


            const nivelEl =
                document.querySelector(
                    `#nivel-caixa-${numero}`
                );


            const litrosEl =
                document.querySelector(
                    `#litros-caixa-${numero}`
                );


            const aguaEl =
                document.querySelector(
                    `#agua-caixa-${numero}`
                );


            const statusEl =
                document.querySelector(
                    `#status-caixa-${numero}`
                );


            const sensorEl =
                pegarTagSensor(numero);


            // SENSOR

            if (sensorEl) {

                sensorEl.textContent =
                    "● SENSOR ATIVO";


                sensorEl.classList.remove(
                    "offline"
                );


                sensorEl.classList.add(
                    "ativo"
                );
            }


            // NIVEL

            if (
                nivelEl &&
                !isNaN(nivel)
            ) {

                nivelEl.textContent =
                    nivel.toFixed(1) +
                    "%";
            }


            // LITROS

            if (
                litrosEl &&
                !isNaN(litros)
            ) {

                litrosEl.textContent =
                    "💧 " +
                    Math.round(litros) +
                    " litros";
            }


            // ÁGUA

            if (
                aguaEl &&
                !isNaN(nivel)
            ) {

                aguaEl.style.height =
                    nivel + "%";
            }


            // STATUS

            if (statusEl) {

                statusEl.textContent =
                    dados.status ||
                    "Normal";
            }
        }


        // ======================================================
        // MONITOR DAS CAIXAS
        // ======================================================


        function monitorarCaixa(numero) {

            const nomeTimestamp =
                `caixa${numero}`;


            const caixaRef =
                ref(
                    db,
                    `caixas/caixa${numero}`
                );


            onValue(

                caixaRef,

                snapshot => {

                    const dados =
                        snapshot.val();


                    console.log(
                        `💧 Caixa ${numero}:`,
                        dados
                    );


                    if (!dados) {

                        timestamps[
                            nomeTimestamp
                        ] = null;


                        atualizarCaixaOffline(
                            numero
                        );


                        verificarStatusEsp32();

                        return;
                    }


                    const timestamp =
                        pegarTimestamp(dados);


                    timestamps[
                        nomeTimestamp
                    ] = timestamp;


                    if (
                        estaOnline(timestamp)
                    ) {

                        atualizarCaixaOnline(
                            numero,
                            dados
                        );

                    } else {

                        atualizarCaixaOffline(
                            numero
                        );
                    }


                    verificarStatusEsp32();
                },


                erro => {

                    console.error(
                        `❌ Erro Caixa ${numero}:`,
                        erro
                    );


                    timestamps[
                        nomeTimestamp
                    ] = null;


                    atualizarCaixaOffline(
                        numero
                    );
                }
            );
        }


        // ======================================================
        // CLIMA
        // AHT20 + BMP280
        // ======================================================


        function atualizarClimaOffline() {

            const temperaturaEl =
                document.querySelector(
                    "#temperatura"
                );


            const umidadeEl =
                document.querySelector(
                    "#umidade"
                );


            const pressaoEl =
                document.querySelector(
                    "#pressao"
                );


            if (temperaturaEl) {

                temperaturaEl.textContent =
                    "--°C";
            }


            if (umidadeEl) {

                umidadeEl.textContent =
                    "--%";
            }


            if (pressaoEl) {

                pressaoEl.textContent =
                    "-- hPa";
            }


            const statusClima =

                document.querySelector(
                    "#status-clima"
                ) ||

                document.querySelector(
                    "#sensor-clima"
                );


            if (statusClima) {

                statusClima.textContent =
                    "🔴 Sensor offline";
            }
        }


        // ------------------------------------------------------


        function atualizarClimaOnline(
            dados
        ) {

            const temperaturaEl =
                document.querySelector(
                    "#temperatura"
                );


            const umidadeEl =
                document.querySelector(
                    "#umidade"
                );


            const pressaoEl =
                document.querySelector(
                    "#pressao"
                );


            if (
                temperaturaEl &&
                dados.temperatura !== undefined
            ) {

                temperaturaEl.textContent =

                    Number(
                        dados.temperatura
                    ).toFixed(1) +

                    "°C";
            }


            if (
                umidadeEl &&
                dados.umidade !== undefined
            ) {

                umidadeEl.textContent =

                    Number(
                        dados.umidade
                    ).toFixed(1) +

                    "%";
            }


            if (
                pressaoEl &&
                dados.pressao !== undefined
            ) {

                pressaoEl.textContent =

                    Number(
                        dados.pressao
                    ).toFixed(1) +

                    " hPa";
            }


            const statusClima =

                document.querySelector(
                    "#status-clima"
                ) ||

                document.querySelector(
                    "#sensor-clima"
                );


            if (statusClima) {

                statusClima.textContent =
                    "🟢 Sensor ativo";
            }
        }


        // ------------------------------------------------------


        const climaRef =
            ref(
                db,
                "clima"
            );


        onValue(

            climaRef,

            snapshot => {

                const dados =
                    snapshot.val();


                console.log(
                    "🌡️ Clima:",
                    dados
                );


                if (!dados) {

                    timestamps.clima =
                        null;


                    atualizarClimaOffline();


                    verificarStatusEsp32();

                    return;
                }


                timestamps.clima =
                    pegarTimestamp(dados);


                if (
                    estaOnline(
                        timestamps.clima
                    )
                ) {

                    atualizarClimaOnline(
                        dados
                    );

                } else {

                    atualizarClimaOffline();
                }


                verificarStatusEsp32();
            }
        );


        // ======================================================
        // CHUVA
        // ======================================================


        function atualizarChuvaOffline() {

            const statusChuva =
                document.querySelector(
                    "#status-chuva"
                );


            if (statusChuva) {

                statusChuva.textContent =
                    "⚪ Sensor offline";
            }


            const sensorChuva =
                document.querySelector(
                    "#sensor-chuva"
                );


            if (sensorChuva) {

                sensorChuva.textContent =
                    "🔴 Sensor offline";
            }
        }


        // ------------------------------------------------------


        function atualizarChuvaOnline(
            dados
        ) {

            const statusChuva =
                document.querySelector(
                    "#status-chuva"
                );


            if (!statusChuva) {
                return;
            }


            if (
                dados.status === "seco"
            ) {

                statusChuva.textContent =
                    "☀️ Sem chuva";

            }


            else if (
                dados.status === "gotas"
            ) {

                statusChuva.textContent =
                    "💧 Gotas detectadas";

            }


            else if (
                dados.status === "chuva"
            ) {

                statusChuva.textContent =
                    "🌧️ Chuva detectada";

            }


            else {

                statusChuva.textContent =
                    "⚪ Sem informação";
            }


            const sensorChuva =
                document.querySelector(
                    "#sensor-chuva"
                );


            if (sensorChuva) {

                sensorChuva.textContent =
                    "🟢 Sensor ativo";
            }
        }


        // ------------------------------------------------------


        const chuvaRef =
            ref(
                db,
                "chuva"
            );


        onValue(

            chuvaRef,

            snapshot => {

                const dados =
                    snapshot.val();


                console.log(
                    "🌧️ Chuva:",
                    dados
                );


                if (!dados) {

                    timestamps.chuva =
                        null;


                    atualizarChuvaOffline();


                    verificarStatusEsp32();

                    return;
                }


                timestamps.chuva =
                    pegarTimestamp(dados);


                if (
                    estaOnline(
                        timestamps.chuva
                    )
                ) {

                    atualizarChuvaOnline(
                        dados
                    );

                } else {

                    atualizarChuvaOffline();
                }


                verificarStatusEsp32();
            }
        );


        // ======================================================
        // INICIA AS 3 CAIXAS
        // ======================================================


        monitorarCaixa(1);

        monitorarCaixa(2);

        monitorarCaixa(3);


        // ======================================================
        // VERIFICAÇÃO AUTOMÁTICA
        // ======================================================


        // A cada 5 segundos reavalia
        // todos os sensores.
        //
        // Isso é importante porque o Firebase
        // não dispara um novo evento quando o
        // ESP32 simplesmente desliga.

        setInterval(() => {


            // CAIXAS

            for (
                let numero = 1;
                numero <= 3;
                numero++
            ) {

                const timestamp =
                    timestamps[
                        `caixa${numero}`
                    ];


                if (
                    !estaOnline(timestamp)
                ) {

                    atualizarCaixaOffline(
                        numero
                    );
                }
            }


            // CLIMA

            if (
                !estaOnline(
                    timestamps.clima
                )
            ) {

                atualizarClimaOffline();
            }


            // CHUVA

            if (
                !estaOnline(
                    timestamps.chuva
                )
            ) {

                atualizarChuvaOffline();
            }


            // ESP32

            verificarStatusEsp32();


        }, 5000);


        // Primeira verificação

        verificarStatusEsp32();

    })
    .catch((erro) => {

        console.error(
            "❌ Erro na autenticação anônima:",
            erro
        );
    });
