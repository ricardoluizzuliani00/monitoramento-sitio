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


// ========================================
// FIREBASE
// ========================================

const firebaseConfig = {

    apiKey:
        "SUA_API_KEY_FIREBASE",

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


const app = initializeApp(
    firebaseConfig,
    "detalhesCaixa"
);

const db = getDatabase(app);
const auth = getAuth(app);


signInAnonymously(auth)
    .then(() => {
        console.log("🔐 Detalhes autenticados anonimamente");

    // ========================================
    // DESCOBRIR QUAL CAIXA FOI ABERTA
    // ========================================

    const parametros =
        new URLSearchParams(
            window.location.search
        );

    const id =
        parametros.get("id") || "1";


    let numeroFirebase;
    let nomeCaixa;
    let capacidade;

    // Status geral do ESP32 vem do heartbeat em /sistema/esp32,
    // igual ao dashboard principal.
    let timestampEsp32 = null;


    // CAIXA PRINCIPAL

    if (id === "principal") {

        numeroFirebase = 3;

        nomeCaixa =
            "Caixa Principal";

        capacidade =
            1000;

    }


    // CAIXA 2

    else if (id === "2") {

        numeroFirebase = 2;

        nomeCaixa =
            "Caixa 2";

        capacidade =
            500;

    }


    // CAIXA 1

    else {

        numeroFirebase = 1;

        nomeCaixa =
            "Caixa 1";

        capacidade =
            500;

    }


    // ========================================
    // ATUALIZAR NOME DA PÁGINA
    // ========================================

    const nomeCaixaEl =
        document.querySelector(
            "#nome-caixa"
        );

    const capacidadeCaixaEl =
        document.querySelector(
            "#capacidade-caixa"
        );

    const capacidadeDetalhesEl =
        document.querySelector(
            "#capacidade-detalhes"
        );


    if (nomeCaixaEl) {

        nomeCaixaEl.textContent =
            "💧 " + nomeCaixa;

    }


    if (capacidadeCaixaEl) {

        capacidadeCaixaEl.textContent =
            `Capacidade • ${capacidade} litros`;

    }


    if (capacidadeDetalhesEl) {

        capacidadeDetalhesEl.textContent =
            `${capacidade} L`;

    }

    // Atualiza o título da aba do navegador
    document.title =
        `${nomeCaixa} • Sítio 4 Irmãos`;


    // ========================================
    // VALOR ATUAL
    // ========================================

    const TEMPO_OFFLINE = 45000;

    let dadosAtuais = null;
    let timestampAtual = null;


    const caixaRef =
        ref(
            db,
            `caixas/caixa${numeroFirebase}`
        );


    // ========================================
    // CONVERTER TIMESTAMP
    // ========================================

    function converterTimestamp(timestamp) {

        if (!timestamp) {
            return null;
        }

        let valor =
            Number(timestamp);

        if (!isNaN(valor)) {

            // ESP32 envia em segundos
            if (valor < 1000000000000) {
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


    // ========================================
    // VERIFICAR SE SENSOR ESTÁ ONLINE
    // ========================================

    function sensorEstaOnline() {

        if (dadosAtuais?.instalado === false) {
            return false;
        }

        if (!timestampAtual) {
            return false;
        }

        return (
            Math.abs(Date.now() - timestampAtual)
            <= TEMPO_OFFLINE
        );
    }


    // ========================================
    // STATUS GERAL DO ESP32
    // ========================================

    function esp32EstaOnline() {
        if (!timestampEsp32) return false;

        return (
            Math.abs(Date.now() - timestampEsp32)
            <= TEMPO_OFFLINE
        );
    }

    function atualizarStatusEsp32() {

        const conexaoEl =
            document.querySelector("#conexao-detalhes");

        if (!conexaoEl) return;

        conexaoEl.textContent =
            esp32EstaOnline()
                ? "🟢 ESP32 ONLINE"
                : "🔴 ESP32 OFFLINE";
    }

    const esp32Ref =
        ref(
            db,
            "sistema/esp32"
        );

    onValue(
        esp32Ref,
        snapshot => {
            const dados = snapshot.val();

            timestampEsp32 =
                dados
                    ? converterTimestamp(
                        dados.timestamp ??
                        dados.ultima_atualizacao ??
                        dados.ultimaAtualizacao
                    )
                    : null;

            atualizarStatusEsp32();
        },
        erro => {
            console.error("❌ Erro heartbeat ESP32:", erro);
            timestampEsp32 = null;
            atualizarStatusEsp32();
        }
    );


    // ========================================
    // MOSTRAR SENSOR OFFLINE
    // ========================================

    function mostrarOffline() {

        const nivelEl = document.querySelector("#nivel-detalhes");
        const litrosEl = document.querySelector("#litros-detalhes");
        const distanciaEl = document.querySelector("#distancia-detalhes");
        const statusEl = document.querySelector("#status-detalhes");
        const atualizacaoEl = document.querySelector("#atualizacao-detalhes");
        const alertaEl = document.querySelector("#alerta-nivel");
        const aguaEl = document.querySelector("#agua-detalhes");

        // Offline = sem valor atual. Leituras antigas ficam apenas no histórico.
        if (nivelEl) nivelEl.textContent = "--%";
        if (litrosEl) litrosEl.textContent = "-- litros";
        if (distanciaEl) distanciaEl.textContent = "-- cm";
        if (aguaEl) aguaEl.style.height = "0%";

        const naoInstalado = dadosAtuais?.instalado === false;

        if (statusEl) {
            statusEl.textContent = naoInstalado
                ? "⚪ Sensor não instalado"
                : (dadosAtuais ? "⚪ Sensor offline" : "⚪ Aguardando sensor");
        }

        if (atualizacaoEl) {
            atualizacaoEl.textContent = dadosAtuais?.ultima_atualizacao || "--";
        }

        if (alertaEl) {
            alertaEl.textContent = naoInstalado
                ? "Sensor ainda não instalado nesta caixa."
                : (dadosAtuais
                    ? "Sensor sem comunicação. A última leitura permanece disponível no histórico."
                    : "Aguardando instalação ou primeira leitura do sensor.");
        }
    }


    // ========================================
    // MOSTRAR SENSOR ONLINE
    // ========================================

    function mostrarOnline() {

        if (!dadosAtuais) {
            mostrarOffline();
            return;
        }


        const nivel =
            Number(
                dadosAtuais.nivel_percentual
            );


        const litros =
            Number(
                dadosAtuais.litros
            );


        const distancia =
            Number(
                dadosAtuais.distancia_cm
            );


        // ---------------- NIVEL ----------------

        const nivelEl =
            document.querySelector(
                "#nivel-detalhes"
            );

        if (
            nivelEl &&
            !isNaN(nivel)
        ) {

            nivelEl.textContent =
                nivel.toFixed(1) +
                "%";
        }


        // ---------------- ÁGUA ----------------

        const aguaEl =
            document.querySelector(
                "#agua-detalhes"
            );

        if (
            aguaEl &&
            !isNaN(nivel)
        ) {

            aguaEl.style.height =
                nivel + "%";
        }


        // ---------------- LITROS ----------------

        const litrosEl =
            document.querySelector(
                "#litros-detalhes"
            );

        if (
            litrosEl &&
            !isNaN(litros)
        ) {

            litrosEl.textContent =
                Math.round(litros) +
                " litros";
        }


        // ---------------- DISTÂNCIA ----------------

        const distanciaEl =
            document.querySelector(
                "#distancia-detalhes"
            );

        if (
            distanciaEl &&
            !isNaN(distancia)
        ) {

            distanciaEl.textContent =
                distancia.toFixed(1) +
                " cm";
        }


        // ---------------- ATUALIZAÇÃO ----------------

        const atualizacaoEl =
            document.querySelector(
                "#atualizacao-detalhes"
            );

        if (atualizacaoEl) {

            atualizacaoEl.textContent =
                dadosAtuais.ultima_atualizacao ||
                "--";
        }


        // ---------------- CONEXÃO ----------------
    // ---------------- STATUS ----------------

        const statusEl =
            document.querySelector(
                "#status-detalhes"
            );

        const status =
            dadosAtuais.status ||
            "";


        if (statusEl) {

            if (status === "cheia") {

                statusEl.textContent =
                    "🟢 Nível alto";

            }

            else if (
                status === "normal"
            ) {

                statusEl.textContent =
                    "🟢 Nível normal";

            }

            else if (
                status === "baixo"
            ) {

                statusEl.textContent =
                    "🟡 Nível baixo";

            }

            else if (
                status === "critico"
            ) {

                statusEl.textContent =
                    "🔴 Nível crítico";

            }

            else {

                statusEl.textContent =
                    "⚪ Status desconhecido";
            }
        }


        // ---------------- ALERTA ----------------

        const alertaEl =
            document.querySelector(
                "#alerta-nivel"
            );


        if (alertaEl) {

            if (nivel < 15) {

                alertaEl.textContent =
                    "🔴 Nível crítico! Verifique o abastecimento.";

            }

            else if (nivel < 30) {

                alertaEl.textContent =
                    "🟡 Nível baixo. Acompanhe o consumo.";

            }

            else {

                alertaEl.textContent =
                    "🟢 Nenhum alerta no momento.";
            }
        }
    }


    // ========================================
    // RECEBER FIREBASE
    // ========================================

    onValue(

        caixaRef,

        snapshot => {
    dadosAtuais =
                snapshot.val();


            if (!dadosAtuais) {

                timestampAtual =
                    null;

                mostrarOffline();

                return;
            }


            timestampAtual =
                converterTimestamp(

                    dadosAtuais.timestamp ??

                    dadosAtuais.ultima_atualizacao ??

                    dadosAtuais.ultimaAtualizacao

                );


            if (
                sensorEstaOnline()
            ) {

                mostrarOnline();

            } else {

                mostrarOffline();
            }
        }
    );


    // ========================================
    // VERIFICAÇÃO AUTOMÁTICA
    // ========================================

    setInterval(
        () => {

            if (
                sensorEstaOnline()
            ) {

                mostrarOnline();

            } else {

                mostrarOffline();
            }

            atualizarStatusEsp32();

        },
        5000
    );

    // ========================================
    // HISTÓRICO
    // ========================================

    let historicoCompleto = [];

    let periodoAtual =
        "24h";

    let grafico =
        null;


    const historicoRef =
        ref(
            db,
            `historico/caixa${numeroFirebase}`
        );


    onValue(
        historicoRef,
        snapshot => {

            historicoCompleto = [];

            // O estado atual do sensor não apaga o passado: histórico
            // permanece disponível mesmo quando a caixa está offline.
            snapshot.forEach(
                item => {

                    const dados =
                        item.val();


                    if (
                        dados.timestamp &&
                        dados.nivel_percentual !== undefined
                    ) {

                        historicoCompleto.push({

                            timestamp:
                                Number(
                                    dados.timestamp
                                ),

                            nivel:
                                Number(
                                    dados.nivel_percentual
                                ),

                            litros:
                                Number(
                                    dados.litros || 0
                                )

                        });

                    }

                }
            );


            historicoCompleto.sort(
                (a, b) =>
                    a.timestamp -
                    b.timestamp
            );


            atualizarGrafico();

        }
    );


    // ========================================
    // FILTRAR HISTÓRICO
    // ========================================

    function filtrarHistorico() {

        const agora =
            Math.floor(
                Date.now() / 1000
            );


        let segundos;


        if (
            periodoAtual === "24h"
        ) {

            segundos =
                24 *
                60 *
                60;

        }

        else if (
            periodoAtual === "7d"
        ) {

            segundos =
                7 *
                24 *
                60 *
                60;

        }

        else {

            segundos =
                30 *
                24 *
                60 *
                60;

        }


        return historicoCompleto.filter(
            item =>
                item.timestamp >=
                agora - segundos
        );

    }


    // ========================================
    // ATUALIZAR GRÁFICO
    // ========================================

    function atualizarGrafico() {

        const dados =
            filtrarHistorico();


        const mensagem =
            document.querySelector(
                "#sem-historico"
            );


        if (dados.length === 0) {

            if (mensagem) {
                mensagem.style.display = "block";

               if (periodoAtual === "24h") {
                    mensagem.textContent =
                        "Sem dados nas últimas 24 horas.";
                }

                else if (periodoAtual === "7d") {
                    mensagem.textContent =
                        "Sem dados nos últimos 7 dias.";
                }

                else {
                    mensagem.textContent =
                        "Sem dados nos últimos 30 dias.";
                }
            }

            if (grafico) {
                grafico.destroy();
                grafico = null;
            }

            return;
        }

        // Há histórico: remove a mensagem "Carregando histórico..."
        // e exibe somente o gráfico.
        if (mensagem) {
            mensagem.style.display = "none";
            mensagem.textContent = "";
        }


        // LABELS DO GRÁFICO

        const labels =
            dados.map(
                item => {

                    const data =
                        new Date(
                            item.timestamp *
                            1000
                        );


                    if (
                        periodoAtual ===
                        "24h"
                    ) {

                        return data
                            .toLocaleTimeString(
                                "pt-BR",
                                {
                                    hour:
                                        "2-digit",

                                    minute:
                                        "2-digit"
                                }
                            );

                    }


                    return data
                        .toLocaleDateString(
                            "pt-BR",
                            {
                                day:
                                    "2-digit",

                                month:
                                    "2-digit"
                            }
                        );

                }
            );


        const niveis =
            dados.map(
                item =>
                    item.nivel
            );


        // APAGA GRÁFICO ANTIGO

        if (grafico) {

            grafico.destroy();

        }


        const canvas =
            document.querySelector(
                "#graficoNivel"
            );


        if (!canvas)
            return;


        // NOVO GRÁFICO

        grafico =
            new Chart(
                canvas,
                {

                    type:
                        "line",

                    data: {

                        labels:
                            labels,

                        datasets: [

                            {

                                label:
                                    "Nível (%)",

                                data:
                                    niveis,

                                borderWidth:
                                    3,

                                tension:
                                    0.35,

                                fill:
                                    true,

                                pointRadius:
                                    dados.length > 40
                                        ? 0
                                        : 3

                            }

                        ]

                    },


                    options: {

                        responsive:
                            true,

                        maintainAspectRatio:
                            false,


                        scales: {

                            y: {
                            min: 0,
                                max: 100,

                            ticks: {
                                stepSize: 10,
                                callback: value => value + "%"
                            },

                        grid: {
        display: true,
        lineWidth: 1,
        color: "rgba(255, 255, 255, 0.10)"
    }
                        }
                            },


                        plugins: {

                            legend: {

                                display:
                                    false

                            },


                            tooltip: {

                                callbacks: {

                                    label:
                                        context =>
                                            ` Nível: ${context.parsed.y.toFixed(1)}%`

                                }

                            }

                        }

                    }

                }
            );

    }



    // ========================================
    // PDF DA CAIXA - COMPLETO / RESUMIDO
    // ========================================

    function nomePeriodoPDF() {
        if (periodoAtual === "24h") return "Últimas 24 horas";
        if (periodoAtual === "7d") return "Últimos 7 dias";
        return "Últimos 30 dias";
    }

    function formatarDataHoraPDF(timestamp) {
        const data = new Date(Number(timestamp) * 1000);

        return {
            data: data.toLocaleDateString("pt-BR"),
            hora: data.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            }),
            curta: `${data.toLocaleDateString("pt-BR")} às ${data.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit"
            })}`
        };
    }

    function statusNivelPDF(nivel) {
        const n = Number(nivel);

        if (!Number.isFinite(n)) return "sem-dados";
        if (n < 15) return "critico";
        if (n < 30) return "atencao";

        return "normal";
    }

    function analisarCaixaPDF(dados) {
        const resultado = {
            minimo: null,
            maximo: null,
            maiorQueda: null,
            maiorSubida: null,
            atencoes: 0,
            criticos: 0,
            recuperacoes: 0,
            eventos: new Map()
        };

        if (!dados.length) return resultado;

        resultado.minimo = dados.reduce(
            (a, b) => b.nivel < a.nivel ? b : a
        );

        resultado.maximo = dados.reduce(
            (a, b) => b.nivel > a.nivel ? b : a
        );

        for (let i = 1; i < dados.length; i++) {
            const ant = dados[i - 1];
            const atual = dados[i];

            const delta = atual.nivel - ant.nivel;

            const variacao = {
                delta,
                inicio: ant,
                fim: atual
            };

            // Só considera queda quando o nível realmente diminuiu.
            if (
                delta < 0 &&
                (
                    !resultado.maiorQueda ||
                    delta < resultado.maiorQueda.delta
                )
            ) {
                resultado.maiorQueda = variacao;
            }

            // Só considera subida quando o nível realmente aumentou.
            if (
                delta > 0 &&
                (
                    !resultado.maiorSubida ||
                    delta > resultado.maiorSubida.delta
                )
            ) {
                resultado.maiorSubida = variacao;
            }

            const antes = statusNivelPDF(ant.nivel);
            const agora = statusNivelPDF(atual.nivel);

            let evento = null;

            if (antes !== "critico" && agora === "critico") {
                resultado.criticos++;
                evento = "critico";
            } else if (antes === "normal" && agora === "atencao") {
                resultado.atencoes++;
                evento = "atencao";
            } else if (
                (antes === "atencao" || antes === "critico") &&
                agora === "normal"
            ) {
                resultado.recuperacoes++;
                evento = "recuperacao";
            }

            if (evento) {
                resultado.eventos.set(atual.timestamp, evento);
            }
        }

        return resultado;
    }

    async function imagemDataURLPDF(src) {
        try {
            const resposta = await fetch(src, {
                cache: "no-store"
            });

            if (!resposta.ok) return null;

            const blob = await resposta.blob();

            return await new Promise((resolve, reject) => {
                const leitor = new FileReader();

                leitor.onload = () => resolve(leitor.result);
                leitor.onerror = reject;

                leitor.readAsDataURL(blob);
            });
        } catch {
            return null;
        }
    }

    function cabecalhoPDFCaixa(doc, imagem) {
        const largura = doc.internal.pageSize.getWidth();

        if (imagem) {
            try {
                doc.addImage(imagem, "PNG", 0, 0, largura, 45.5);
            } catch (erro) {
                console.warn("Não foi possível inserir o cabeçalho:", erro);
            }
        }

        doc.setFillColor(255, 255, 255);
        doc.rect(0, 45.5, largura, 19, "F");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.setTextColor(38, 45, 52);
        doc.text(`Relatório • ${nomeCaixa}`, 14, 56.5);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(105, 112, 119);
        doc.text(nomePeriodoPDF(), largura - 14, 56.5, {
            align: "right"
        });

        doc.setDrawColor(199, 169, 91);
        doc.setLineWidth(0.7);
        doc.line(14, 62, largura - 14, 62);
    }

    // Cartão usado no resumo do PDF.
    function cardPDF(doc, x, y, w, titulo, valor, detalhe, cor) {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(216, 221, 226);
        doc.roundedRect(x, y, w, 20, 2, 2, "FD");

        doc.setFillColor(...cor);
        doc.roundedRect(x, y, w, 1.6, 1, 1, "F");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.2);
        doc.setTextColor(90, 99, 108);
        doc.text(titulo, x + 3, y + 6);

        doc.setFontSize(9);
        doc.setTextColor(45, 52, 60);
        doc.text(valor, x + 3, y + 13);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(5.5);
        doc.setTextColor(105, 112, 119);
        doc.text(detalhe || "--", x + 3, y + 17.2);
    }

    function rodapePDFCaixa(doc) {
        const total = doc.internal.getNumberOfPages();
        const largura = doc.internal.pageSize.getWidth();
        const altura = doc.internal.pageSize.getHeight();
        const gerado = new Date().toLocaleString("pt-BR");

        for (let i = 1; i <= total; i++) {
            doc.setPage(i);
            doc.setDrawColor(199, 169, 91);
            doc.line(14, altura - 13, largura - 14, altura - 13);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(6.5);
            doc.setTextColor(110);

            doc.text(`Gerado em ${gerado}`, 14, altura - 7);
            doc.text(`Página ${i} de ${total}`, largura - 14, altura - 7, {
                align: "right"
            });
        }
    }

    async function gerarPDFCaixa(modo = "completo") {
        const botao = document.querySelector(
            modo === "completo"
                ? "#pdf-caixa-completo"
                : "#pdf-caixa-resumido"
        );

        const original = botao?.textContent || "PDF";

        if (
            !window.jspdf?.jsPDF ||
            typeof window.jspdf.jsPDF.API.autoTable !== "function"
        ) {
            alert("O gerador de PDF não foi carregado. Atualize a página e tente novamente.");
            return;
        }

        try {
            if (botao) {
                botao.disabled = true;
                botao.textContent = "Gerando...";
            }

            const dados = filtrarHistorico();
            const analise = analisarCaixaPDF(dados);
            const imagem = await imagemDataURLPDF("icons/cabecalho-sitio.png");

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: "portrait",
                unit: "mm",
                format: "a4"
            });

            cabecalhoPDFCaixa(doc, imagem);

            let y = 70;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(40, 47, 54);
            doc.text(
                modo === "completo"
                    ? "Resumo e histórico da caixa"
                    : "Resumo da caixa",
                14,
                y
            );

            y += 5;

            if (!dados.length) {
                doc.autoTable({
                    startY: y,
                    head: [["Data", "Hora", "Nível", "Litros"]],
                    body: [["-", "-", "Sem registros no período", "-"]],
                    theme: "grid",
                    styles: {
                        fontSize: 6,
                        cellPadding: 0.8
                    },
                    headStyles: {
                        fillColor: [31, 36, 41],
                        textColor: [239, 195, 83]
                    },
                    margin: {
                        left: 14,
                        right: 14,
                        bottom: 16
                    }
                });
            } else {
                const util = doc.internal.pageSize.getWidth() - 28;
                const gap = 2.5;
                const w = (util - gap * 3) / 4;

                cardPDF(
                    doc, 14, y, w,
                    "MENOR NÍVEL",
                    `${analise.minimo.nivel.toFixed(1).replace(".", ",")} %`,
                    formatarDataHoraPDF(analise.minimo.timestamp).curta,
                    [180, 35, 35]
                );

                cardPDF(
                    doc, 14 + w + gap, y, w,
                    "MAIOR NÍVEL",
                    `${analise.maximo.nivel.toFixed(1).replace(".", ",")} %`,
                    formatarDataHoraPDF(analise.maximo.timestamp).curta,
                    [40, 112, 60]
                );

                cardPDF(
                    doc, 14 + 2 * (w + gap), y, w,
                    "MAIOR QUEDA",
                    analise.maiorQueda
                        ? `Queda ${Math.abs(analise.maiorQueda.delta).toFixed(1).replace(".", ",")}`
                        : "--",
                    analise.maiorQueda
                        ? "Pontos percentuais"
                        : "Sem queda registrada",
                    [180, 35, 35]
                );

                cardPDF(
                    doc, 14 + 3 * (w + gap), y, w,
                    "MAIOR SUBIDA",
                    analise.maiorSubida
                        ? `Subida ${analise.maiorSubida.delta.toFixed(1).replace(".", ",")}`
                        : "--",
                    analise.maiorSubida
                        ? "Pontos percentuais"
                        : "Sem subida registrada",
                    [40, 112, 60]
                );

                y += 25;

                // Explicação por extenso, incluindo início e fim da variação.
                const explicacoes = [];

                if (analise.maiorQueda) {
                    const v = analise.maiorQueda;
                    const inicio = formatarDataHoraPDF(v.inicio.timestamp);
                    const fim = formatarDataHoraPDF(v.fim.timestamp);
                    const pontos = Math.abs(v.delta).toFixed(1).replace(".", ",");

                    explicacoes.push(
                        `O nível da água diminuiu ${pontos} pontos percentuais, de ${inicio.curta} até ${fim.curta}.`
                    );
                }

                if (analise.maiorSubida) {
                    const v = analise.maiorSubida;
                    const inicio = formatarDataHoraPDF(v.inicio.timestamp);
                    const fim = formatarDataHoraPDF(v.fim.timestamp);
                    const pontos = v.delta.toFixed(1).replace(".", ",");

                    explicacoes.push(
                        `O nível da água aumentou ${pontos} pontos percentuais, de ${inicio.curta} até ${fim.curta}.`
                    );
                }

                doc.setFont("helvetica", "normal");
                doc.setFontSize(7);
                doc.setTextColor(70, 78, 86);

                for (const explicacao of explicacoes) {
                    const linhas = doc.splitTextToSize(
                        explicacao,
                        doc.internal.pageSize.getWidth() - 28
                    );

                    doc.text(linhas, 14, y);
                    y += linhas.length * 3.5;
                }

                y += 2;

                doc.setFont("helvetica", "normal");
                doc.setFontSize(7);
                doc.setTextColor(90, 99, 108);
                doc.text(
                    `Eventos: atenção ${analise.atencoes} • crítico ${analise.criticos} • recuperações ${analise.recuperacoes}`,
                    14,
                    y
                );

                y += 5;

                if (modo === "completo") {
                    const linhas = dados.map(item => {
                        const dh = formatarDataHoraPDF(item.timestamp);

                        return [
                            dh.data,
                            dh.hora,
                            `${item.nivel.toFixed(1).replace(".", ",")} %`,
                            `${Math.round(item.litros)} L`
                        ];
                    });

                    doc.autoTable({
                        startY: y,
                        head: [["Data", "Hora", "Nível", "Litros"]],
                        body: linhas,
                        theme: "grid",
                        styles: {
                            fontSize: 5.7,
                            cellPadding: 0.65,
                            lineWidth: 0.08
                        },
                        headStyles: {
                            fontSize: 6.1,
                            fillColor: [31, 36, 41],
                            textColor: [239, 195, 83],
                            fontStyle: "bold"
                        },
                        alternateRowStyles: {
                            fillColor: [247, 247, 247]
                        },
                        margin: {
                            left: 14,
                            right: 14,
                            top: 12,
                            bottom: 16
                        },
                        didParseCell(data) {
                            if (
                                data.section !== "body" ||
                                data.column.index !== 2
                            ) return;

                            const item = dados[data.row.index];
                            const ev = analise.eventos.get(item.timestamp);
                            const st = statusNivelPDF(item.nivel);

                            if (ev === "recuperacao") {
                                data.cell.styles.fillColor = [230, 244, 234];
                                data.cell.styles.textColor = [40, 112, 60];
                                data.cell.styles.fontStyle = "bold";
                            } else if (st === "critico") {
                                data.cell.styles.fillColor = [255, 226, 226];
                                data.cell.styles.textColor = [180, 35, 35];
                                data.cell.styles.fontStyle = "bold";
                            } else if (st === "atencao") {
                                data.cell.styles.fillColor = [255, 242, 204];
                                data.cell.styles.textColor = [140, 95, 0];
                                data.cell.styles.fontStyle = "bold";
                            }
                        }
                    });
                } else {
                    doc.setFillColor(248, 249, 250);
                    doc.setDrawColor(224, 227, 230);
                    doc.roundedRect(
                        14, y,
                        doc.internal.pageSize.getWidth() - 28,
                        17, 2, 2, "FD"
                    );

                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(7);
                    doc.setTextColor(55, 62, 69);
                    doc.text("Leituras consideradas", 18, y + 6);

                    doc.setFont("helvetica", "normal");
                    doc.setFontSize(8);
                    doc.text(
                        `${dados.length} registros em ${nomePeriodoPDF().toLowerCase()}.`,
                        18,
                        y + 12
                    );

                    y += 22;

                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(9);
                    doc.setTextColor(40, 47, 54);
                    doc.text("Medições da caixa no período", 14, y);

                    y += 3;

                    const linhasResumidas = dados.map(item => {
                        const dh = formatarDataHoraPDF(item.timestamp);

                        return [
                            dh.data,
                            dh.hora,
                            `${item.nivel.toFixed(1).replace(".", ",")} %`,
                            `${Math.round(item.litros)} L`
                        ];
                    });

                    doc.autoTable({
                        startY: y,
                        head: [["Data", "Hora", "Nível", "Litros"]],
                        body: linhasResumidas,
                        theme: "grid",
                        styles: {
                            fontSize: 5.3,
                            cellPadding: 0.5,
                            lineWidth: 0.07
                        },
                        headStyles: {
                            fontSize: 5.8,
                            fillColor: [31, 36, 41],
                            textColor: [239, 195, 83],
                            fontStyle: "bold"
                        },
                        alternateRowStyles: {
                            fillColor: [247, 247, 247]
                        },
                        margin: {
                            left: 14,
                            right: 14,
                            top: 12,
                            bottom: 16
                        },
                        didParseCell(data) {
                            if (
                                data.section !== "body" ||
                                data.column.index !== 2
                            ) return;

                            const item = dados[data.row.index];
                            const ev = analise.eventos.get(item.timestamp);
                            const st = statusNivelPDF(item.nivel);

                            if (ev === "recuperacao") {
                                data.cell.styles.fillColor = [230, 244, 234];
                                data.cell.styles.textColor = [40, 112, 60];
                                data.cell.styles.fontStyle = "bold";
                            } else if (st === "critico") {
                                data.cell.styles.fillColor = [255, 226, 226];
                                data.cell.styles.textColor = [180, 35, 35];
                                data.cell.styles.fontStyle = "bold";
                            } else if (st === "atencao") {
                                data.cell.styles.fillColor = [255, 242, 204];
                                data.cell.styles.textColor = [140, 95, 0];
                                data.cell.styles.fontStyle = "bold";
                            }
                        }
                    });
                }
            }

            rodapePDFCaixa(doc);

            const data = new Date()
                .toLocaleDateString("pt-BR")
                .replaceAll("/", "-");

            const nomeArquivo = nomeCaixa
                .toLowerCase()
                .replaceAll(" ", "-")
                .replaceAll("á", "a");

            doc.save(
                `${modo === "completo" ? "relatorio" : "resumo"}-${nomeArquivo}-${periodoAtual}-${data}.pdf`
            );

        } catch (erro) {
            console.error("Erro ao gerar PDF da caixa:", erro);
            alert("Não foi possível gerar o PDF. Confira o console do navegador.");
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.textContent = original;
            }
        }
    }

    document.querySelector("#pdf-caixa-completo")?.addEventListener("click", () => {
        // O PDF completo continua sendo o relatório geral do sítio.
        const url = `clima.html?autoPdf=completo&periodo=${encodeURIComponent(periodoAtual)}`;
        const aba = window.open(url, "_blank");

        if (!aba) {
            window.location.href = url;
        }
    });

    document.querySelector("#pdf-caixa-resumido")?.addEventListener("click", () => {
        gerarPDFCaixa("resumido");
    });

    // ========================================
    // BOTÕES 24H / 7D / 30D
    // ========================================

    document
        .querySelectorAll(
            ".filtro"
        )
        .forEach(
            botao => {

                botao.addEventListener(
                    "click",
                    () => {

                        document
                            .querySelectorAll(
                                ".filtro"
                            )
                            .forEach(
                                b => {

                                    b.classList.remove(
                                        "ativo"
                                    );

                                }
                            );


                        botao.classList.add(
                            "ativo"
                        );


                        periodoAtual =
                            botao.dataset
                                .periodo;


                        atualizarGrafico();

                    }
                );

            }
        );
        
    })
    .catch((erro) => {
        console.error("❌ Erro na autenticação da página de detalhes:", erro);

        const conexaoEl = document.querySelector("#conexao-detalhes");
        if (conexaoEl) {
            conexaoEl.textContent = "🔴 Erro de autenticação";
        }

        const mensagem = document.querySelector("#sem-historico");
        if (mensagem) {
            mensagem.style.display = "block";
            mensagem.textContent = "Não foi possível carregar os dados.";
        }
    });
