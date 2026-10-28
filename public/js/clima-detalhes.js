
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getDatabase,
    ref,
    onValue,
    get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import {
    getAuth,
    signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

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

const parametrosPagina = new URLSearchParams(window.location.search);
const autoPdf = parametrosPagina.get("autoPdf");
const periodoSolicitado = parametrosPagina.get("periodo");

if (["24h", "7d", "30d"].includes(periodoSolicitado)) {
    periodoAtual = periodoSolicitado;
}

let autoPdfDisparado = false;

const NORMAIS_TEMPERATURA_UBERABA = {
    1: { min: 19.6, max: 30.0 },
    2: { min: 19.3, max: 30.6 },
    3: { min: 19.2, max: 30.3 },
    4: { min: 17.5, max: 30.0 },
    5: { min: 14.3, max: 28.0 },
    6: { min: 13.1, max: 27.5 },
    7: { min: 12.8, max: 28.0 },
    8: { min: 14.1, max: 30.1 },
    9: { min: 16.8, max: 31.4 },
    10: { min: 18.5, max: 31.8 },
    11: { min: 19.0, max: 30.3 },
    12: { min: 19.6, max: 30.1 }
};

function classificarTemperatura(timestamp, temperatura) {
    const mes = new Date(timestamp * 1000).getMonth() + 1;
    const normal = NORMAIS_TEMPERATURA_UBERABA[mes];

    if (!normal || !Number.isFinite(Number(temperatura))) return "normal";
    if (Number(temperatura) < normal.min) return "baixa";
    if (Number(temperatura) > normal.max) return "alta";
    return "normal";
}

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

    if (el) {
        el.textContent = estaOnline(timestampEsp32)
            ? "🟢 ESP32 ONLINE"
            : "🔴 ESP32 OFFLINE";
    }
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
    else if (status === "indisponivel" || status === "offline") {
        el.textContent = "⚪ Sensor de chuva indisponível";
    } else {
        el.textContent = "⚪ Sem dados";
    }
}

function filtrarHistorico() {
    const agora = Math.floor(Date.now() / 1000);
    const segundos = segundosDoPeriodo();

    return historicoCompleto.filter(
        item => item.timestamp >= agora - segundos
    );
}

function segundosDoPeriodo() {
    return periodoAtual === "24h"
        ? 86400
        : periodoAtual === "7d"
            ? 604800
            : 2592000;
}

function nomeDoPeriodo() {
    return periodoAtual === "24h"
        ? "Últimas 24 horas"
        : periodoAtual === "7d"
            ? "Últimos 7 dias"
            : "Últimos 30 dias";
}

function formatarDataHora(timestamp) {
    const data = new Date(timestamp * 1000);

    return {
        data: data.toLocaleDateString("pt-BR"),
        hora: data.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        })
    };
}

async function carregarImagemComoDataURL(caminho) {
    try {
        const resposta = await fetch(caminho, { cache: "no-store" });
        if (!resposta.ok) return null;

        const blob = await resposta.blob();

        return await new Promise(resolve => {
            const leitor = new FileReader();
            leitor.onload = () => resolve(leitor.result);
            leitor.onerror = () => resolve(null);
            leitor.readAsDataURL(blob);
        });
    } catch (erro) {
        console.warn("Não foi possível carregar a imagem do relatório:", erro);
        return null;
    }
}

async function buscarHistoricoCaixa(numeroFirebase) {
    const snapshot = await get(ref(db, `historico/caixa${numeroFirebase}`));
    const limite = Math.floor(Date.now() / 1000) - segundosDoPeriodo();
    const dados = [];

    snapshot.forEach(item => {
        const valor = item.val();
        const timestamp = Number(valor?.timestamp);
        const nivel = Number(valor?.nivel_percentual);
        const litros = Number(valor?.litros);

        if (
            Number.isFinite(timestamp) &&
            Number.isFinite(nivel) &&
            timestamp >= limite
        ) {
            dados.push({
                timestamp,
                nivel,
                litros: Number.isFinite(litros) ? litros : 0
            });
        }
    });

    dados.sort((a, b) => a.timestamp - b.timestamp);
    return dados;
}

async function buscarHistoricoChuva() {
    const snapshot = await get(ref(db, "historico/chuva"));
    const limite = Math.floor(Date.now() / 1000) - segundosDoPeriodo();
    const dentro = [];
    let anteriorAoPeriodo = null;

    snapshot.forEach(item => {
        const valor = item.val() || {};
        let timestamp = Number(
            valor.timestamp ?? valor.ts ?? valor.data_timestamp
        );

        if (Number.isFinite(timestamp) && timestamp > 1000000000000) {
            timestamp = Math.floor(timestamp / 1000);
        }

        const status = String(
            valor.status ?? valor.evento ?? ""
        ).toLowerCase();

        const leitura = Number(valor.valor);

        if (
            !Number.isFinite(timestamp) ||
            !["seco", "gotas", "chuva"].includes(status)
        ) {
            return;
        }

        const registro = {
            timestamp,
            status,
            valor: Number.isFinite(leitura) ? leitura : null
        };

        if (timestamp < limite) {
            if (
                !anteriorAoPeriodo ||
                timestamp > anteriorAoPeriodo.timestamp
            ) {
                anteriorAoPeriodo = registro;
            }
        } else {
            dentro.push(registro);
        }
    });

    dentro.sort((a, b) => a.timestamp - b.timestamp);

    const resultado = [];

    if (anteriorAoPeriodo) {
        resultado.push({
            ...anteriorAoPeriodo,
            anteriorAoPeriodo: true
        });
    }

    for (const item of dentro) {
        const anterior = resultado[resultado.length - 1];

        if (!anterior || anterior.status !== item.status) {
            resultado.push(item);
        }
    }

    return resultado;
}

async function buscarEstadoChuvaAtual() {
    const snapshot = await get(ref(db, "chuva"));
    const valor = snapshot.val() || {};

    return {
        status: String(valor.status ?? "").toLowerCase(),
        online: valor.online === true,
        timestamp: Number(valor.timestamp) || null
    };
}

function analisarHistoricoChuva(dados, estadoAtual = null) {
    const eventosPeriodo = dados.filter(item => !item.anteriorAoPeriodo);
    let estado = dados.find(item => item.anteriorAoPeriodo)?.status || null;

    let inicioChuva = estado === "chuva"
        ? Math.floor(Date.now() / 1000) - segundosDoPeriodo()
        : null;

    const episodios = [];

    for (const item of eventosPeriodo) {
        if (item.status === "chuva" && estado !== "chuva") {
            inicioChuva = item.timestamp;
        } else if (estado === "chuva" && item.status !== "chuva" && inicioChuva) {
            episodios.push({
                inicio: inicioChuva,
                fim: item.timestamp
            });

            inicioChuva = null;
        }

        estado = item.status;
    }

    if (estado === "chuva" && inicioChuva) {
        episodios.push({
            inicio: inicioChuva,
            fim: null
        });
    }

    const houveChuva =
        episodios.length > 0 ||
        eventosPeriodo.some(item => item.status === "chuva");

    const ultimoEventoChuva =
        [...eventosPeriodo].reverse().find(item => item.status === "chuva") ||
        (
            dados.find(item => item.anteriorAoPeriodo)?.status === "chuva"
                ? dados.find(item => item.anteriorAoPeriodo)
                : null
        );

    const totalDuracaoSeg = episodios.reduce((soma, ep) => {
        if (!ep.fim) return soma;
        return soma + Math.max(0, ep.fim - ep.inicio);
    }, 0);

    const semLeitura = !dados.length;

    const sensorIndisponivel =
        semLeitura &&
        (
            estadoAtual?.status === "indisponivel" ||
            estadoAtual?.online === false
        );

    return {
        houveChuva,
        episodios,
        totalDuracaoSeg,
        ultimoEventoChuva,
        eventosPeriodo,
        sensorIndisponivel,
        semLeitura
    };
}

async function buscarHistoricoEsp32() {
    const snapshot = await get(ref(db, "historico/esp32"));
    const limite = Math.floor(Date.now() / 1000) - segundosDoPeriodo();
    const dados = [];

    snapshot.forEach(item => {
        const valor = item.val() || {};
        let timestamp = Number(
            valor.timestamp ?? valor.ts ?? valor.data_timestamp
        );

        if (Number.isFinite(timestamp) && timestamp > 1000000000000) {
            timestamp = Math.floor(timestamp / 1000);
        }

        let status = String(
            valor.status ?? valor.evento ?? ""
        ).toLowerCase();

        if (typeof valor.online === "boolean") {
            status = valor.online ? "online" : "offline";
        }

        if (status.includes("on")) status = "online";
        if (status.includes("off")) status = "offline";

        if (
            Number.isFinite(timestamp) &&
            timestamp >= limite &&
            (status === "online" || status === "offline")
        ) {
            dados.push({ timestamp, status });
        }
    });

    dados.sort((a, b) => a.timestamp - b.timestamp);

    return dados.filter(
        (item, indice) =>
            indice === 0 || item.status !== dados[indice - 1].status
    );
}

function analisarHistoricoEsp32(dados) {
    let quedas = 0;
    let totalOfflineSeg = 0;
    const duracaoPorTimestamp = new Map();

    for (let i = 0; i < dados.length; i++) {
        const atual = dados[i];
        if (atual.status !== "offline") continue;

        quedas++;

        const proximoOnline = dados
            .slice(i + 1)
            .find(item => item.status === "online");

        if (proximoOnline) {
            const duracao = Math.max(
                0,
                proximoOnline.timestamp - atual.timestamp
            );

            totalOfflineSeg += duracao;
            duracaoPorTimestamp.set(atual.timestamp, duracao);
        }
    }

    return { quedas, totalOfflineSeg, duracaoPorTimestamp };
}

function formatarDuracao(segundos) {
    if (!Number.isFinite(segundos)) return "--";
    if (segundos < 60) return `${Math.round(segundos)} s`;

    const minutos = Math.floor(segundos / 60);
    const horas = Math.floor(minutos / 60);
    const minRestantes = minutos % 60;

    if (horas > 0) return `${horas} h ${minRestantes} min`;
    return `${minutos} min`;
}

function classificarUmidade(umidade) {
    const valor = Number(umidade);
    if (!Number.isFinite(valor)) return "normal";
    if (valor <= 30) return "baixa";
    if (valor >= 80) return "alta";
    return "normal";
}

function encontrarExtremo(dados, chave, tipo = "min") {
    if (!dados.length) return null;

    return dados.reduce((melhor, atual) => {
        if (!melhor) return atual;

        return tipo === "min"
            ? (
                Number(atual[chave]) < Number(melhor[chave])
                    ? atual
                    : melhor
            )
            : (
                Number(atual[chave]) > Number(melhor[chave])
                    ? atual
                    : melhor
            );
    }, null);
}

// Só considera quedas negativas e subidas positivas.
function encontrarVariacaoEmJanela(dados, chave, minutos = 60) {
    if (dados.length < 2) {
        return { queda: null, subida: null };
    }

    const alvoMs = minutos * 60;
    const tolerancia = 6 * 60;
    let queda = null;
    let subida = null;

    for (let i = 0; i < dados.length; i++) {
        const inicio = dados[i];
        const alvo = inicio.timestamp + alvoMs;
        let fim = null;
        let menorDistancia = Infinity;

        for (let j = i + 1; j < dados.length; j++) {
            const distancia = Math.abs(dados[j].timestamp - alvo);

            if (distancia < menorDistancia) {
                menorDistancia = distancia;
                fim = dados[j];
            }

            if (dados[j].timestamp > alvo + tolerancia) break;
        }

        if (!fim || menorDistancia > tolerancia) continue;

        const delta = Number(fim[chave]) - Number(inicio[chave]);
        const evento = { delta, inicio, fim };

        if (delta < 0 && (!queda || delta < queda.delta)) {
            queda = evento;
        }

        if (delta > 0 && (!subida || delta > subida.delta)) {
            subida = evento;
        }
    }

    return { queda, subida };
}

function statusNivel(nivel) {
    const n = Number(nivel);

    if (!Number.isFinite(n)) return "sem-dados";
    if (n < 15) return "critico";
    if (n < 30) return "atencao";

    return "normal";
}

function analisarHistoricoCaixa(dados) {
    if (!dados.length) {
        return {
            minimo: null,
            maximo: null,
            maiorQueda: null,
            maiorSubida: null,
            atencoes: 0,
            criticos: 0,
            recuperacoes: 0,
            eventosPorTimestamp: new Map()
        };
    }

    const minimo = encontrarExtremo(dados, "nivel", "min");
    const maximo = encontrarExtremo(dados, "nivel", "max");

    let maiorQueda = null;
    let maiorSubida = null;
    let atencoes = 0;
    let criticos = 0;
    let recuperacoes = 0;

    const eventosPorTimestamp = new Map();

    for (let i = 1; i < dados.length; i++) {
        const anterior = dados[i - 1];
        const atual = dados[i];

        const delta = Number(atual.nivel) - Number(anterior.nivel);
        const variacao = {
            delta,
            inicio: anterior,
            fim: atual
        };

        if (delta < 0 && (!maiorQueda || delta < maiorQueda.delta)) {
            maiorQueda = variacao;
        }

        if (delta > 0 && (!maiorSubida || delta > maiorSubida.delta)) {
            maiorSubida = variacao;
        }

        const antes = statusNivel(anterior.nivel);
        const agora = statusNivel(atual.nivel);
        let evento = null;

        if (antes !== "critico" && agora === "critico") {
            criticos++;
            evento = "critico";
        } else if (antes === "normal" && agora === "atencao") {
            atencoes++;
            evento = "atencao";
        } else if (
            (antes === "atencao" || antes === "critico") &&
            agora === "normal"
        ) {
            recuperacoes++;
            evento = "recuperacao";
        }

        if (evento) {
            eventosPorTimestamp.set(atual.timestamp, evento);
        }
    }

    return {
        minimo,
        maximo,
        maiorQueda,
        maiorSubida,
        atencoes,
        criticos,
        recuperacoes,
        eventosPorTimestamp
    };
}

function formatarDataHoraCurta(timestamp) {
    if (!timestamp) return "--";

    const data = new Date(timestamp * 1000);

    return `${data.toLocaleDateString("pt-BR")} às ${
        data.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit"
        })
    }`;
}

function formatarIntervalo(inicio, fim) {
    if (!inicio || !fim) return "--";

    const a = new Date(inicio.timestamp * 1000);
    const b = new Date(fim.timestamp * 1000);

    return `${a.toLocaleDateString("pt-BR")} ${
        a.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit"
        })
    } → ${
        b.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit"
        })
    }`;
}

function adicionarCabecalhoRelatorio(doc, cabecalhoDataUrl) {
    const largura = doc.internal.pageSize.getWidth();

    if (cabecalhoDataUrl) {
        try {
            doc.addImage(cabecalhoDataUrl, "PNG", 0, 0, largura, 45.5);
        } catch (erro) {
            console.warn(
                "Imagem do cabeçalho não pôde ser adicionada ao PDF:",
                erro
            );
        }
    }

    doc.setFillColor(255, 255, 255);
    doc.rect(0, 45.5, largura, 19, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(38, 45, 52);
    doc.text("Relatório de Histórico", 14, 56.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(105, 112, 119);
    doc.text(nomeDoPeriodo(), largura - 14, 56.5, {
        align: "right"
    });

    doc.setDrawColor(199, 169, 91);
    doc.setLineWidth(0.7);
    doc.line(14, 62, largura - 14, 62);
}

function adicionarRodapeRelatorio(doc) {
    const totalPaginas = doc.internal.getNumberOfPages();
    const largura = doc.internal.pageSize.getWidth();
    const altura = doc.internal.pageSize.getHeight();
    const geradoEm = new Date().toLocaleString("pt-BR");

    for (let pagina = 1; pagina <= totalPaginas; pagina++) {
        doc.setPage(pagina);
        doc.setDrawColor(199, 169, 91);
        doc.setLineWidth(0.25);
        doc.line(14, altura - 13, largura - 14, altura - 13);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(110);
        doc.text(`Gerado em ${geradoEm}`, 14, altura - 7);
        doc.text(`Página ${pagina} de ${totalPaginas}`, largura - 14, altura - 7, {
            align: "right"
        });
    }
}

function desenharCardResumo(
    doc,
    x,
    y,
    largura,
    altura,
    titulo,
    valor,
    detalhe,
    cor = [199, 169, 91]
) {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(216, 221, 226);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, largura, altura, 2, 2, "FD");

    doc.setFillColor(...cor);
    doc.roundedRect(x, y, largura, 1.6, 1, 1, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(90, 99, 108);
    doc.text(titulo, x + 3, y + 6);

    doc.setFontSize(10.5);
    doc.setTextColor(45, 52, 60);
    doc.text(valor, x + 3, y + 13);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.6);
    doc.setTextColor(105, 112, 119);
    doc.text(detalhe || "--", x + 3, y + altura - 3);
}

function desenharResumoClima(doc, dados, inicioY) {
    if (!dados.length) return inicioY;

    const tmin = encontrarExtremo(dados, "temperatura", "min");
    const tmax = encontrarExtremo(dados, "temperatura", "max");
    const hmin = encontrarExtremo(dados, "umidade", "min");
    const hmax = encontrarExtremo(dados, "umidade", "max");
    const variacao = encontrarVariacaoEmJanela(dados, "pressao", 60);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(40, 47, 54);
    doc.text("Resumo do período", 14, inicioY);

    const larguraUtil = doc.internal.pageSize.getWidth() - 28;
    const gap = 2.5;
    const cardW = (larguraUtil - gap * 2) / 3;
    const cardH = 20;
    let y = inicioY + 4;

    desenharCardResumo(
        doc, 14, y, cardW, cardH,
        "TEMPERATURA MÍNIMA",
        `${Number(tmin.temperatura).toFixed(1)} °C`,
        formatarDataHoraCurta(tmin.timestamp),
        [20, 92, 170]
    );

    desenharCardResumo(
        doc, 14 + cardW + gap, y, cardW, cardH,
        "TEMPERATURA MÁXIMA",
        `${Number(tmax.temperatura).toFixed(1)} °C`,
        formatarDataHoraCurta(tmax.timestamp),
        [180, 35, 35]
    );

    desenharCardResumo(
        doc, 14 + 2 * (cardW + gap), y, cardW, cardH,
        "UMIDADE MÍNIMA",
        `${Number(hmin.umidade).toFixed(1)} %`,
        formatarDataHoraCurta(hmin.timestamp),
        [138, 75, 0]
    );

    y += cardH + 2.5;

    desenharCardResumo(
        doc, 14, y, cardW, cardH,
        "UMIDADE MÁXIMA",
        `${Number(hmax.umidade).toFixed(1)} %`,
        formatarDataHoraCurta(hmax.timestamp),
        [20, 92, 170]
    );

    const queda = variacao.queda;
    const subida = variacao.subida;

    desenharCardResumo(
        doc, 14 + cardW + gap, y, cardW, cardH,
        "MAIOR QUEDA DE PRESSÃO (1h)",
        queda ? `${queda.delta.toFixed(1)} hPa` : "--",
        queda
            ? formatarIntervalo(queda.inicio, queda.fim)
            : "Sem janela suficiente",
        [138, 75, 0]
    );

    desenharCardResumo(
        doc, 14 + 2 * (cardW + gap), y, cardW, cardH,
        "MAIOR SUBIDA DE PRESSÃO (1h)",
        subida ? `+${subida.delta.toFixed(1)} hPa` : "--",
        subida
            ? formatarIntervalo(subida.inicio, subida.fim)
            : "Sem janela suficiente",
        [20, 92, 170]
    );

    return y + cardH + 8;
}

function tabelaClimaPDF(doc, dados, inicioY, eventosPressao) {
    const linhas = dados.map(item => {
        const dh = formatarDataHora(item.timestamp);

        return [
            dh.data,
            dh.hora,
            `${Number(item.temperatura).toFixed(1)} °C`,
            `${Number(item.umidade).toFixed(1)} %`,
            `${Number(item.pressao).toFixed(1)} hPa`
        ];
    });

    doc.autoTable({
        startY: inicioY,
        head: [["Data", "Hora", "Temperatura", "Umidade", "Pressão"]],
        body: linhas.length
            ? linhas
            : [["-", "-", "Sem registros", "-", "-"]],
        theme: "grid",
        styles: {
            fontSize: 5.7,
            cellPadding: 0.65,
            lineWidth: 0.08,
            valign: "middle"
        },
        headStyles: {
            fontSize: 6.1,
            fillColor: [31, 36, 41],
            textColor: [239, 195, 83],
            fontStyle: "bold"
        },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        margin: { left: 14, right: 14, top: 12, bottom: 16 },

        didParseCell(data) {
            if (data.section !== "body") return;

            const item = dados[data.row.index];
            if (!item) return;

            if (data.column.index === 2) {
                const classificacao = classificarTemperatura(
                    item.timestamp,
                    item.temperatura
                );

                if (classificacao === "baixa") {
                    data.cell.styles.fillColor = [222, 238, 255];
                    data.cell.styles.textColor = [20, 92, 170];
                    data.cell.styles.fontStyle = "bold";
                } else if (classificacao === "alta") {
                    data.cell.styles.fillColor = [255, 226, 226];
                    data.cell.styles.textColor = [180, 35, 35];
                    data.cell.styles.fontStyle = "bold";
                }
            }

            if (data.column.index === 3) {
                const umidade = classificarUmidade(item.umidade);

                if (umidade === "baixa") {
                    data.cell.styles.fillColor = [255, 233, 194];
                    data.cell.styles.textColor = [138, 75, 0];
                    data.cell.styles.fontStyle = "bold";
                } else if (umidade === "alta") {
                    data.cell.styles.fillColor = [222, 238, 255];
                    data.cell.styles.textColor = [20, 92, 170];
                    data.cell.styles.fontStyle = "bold";
                }
            }

            if (data.column.index === 4 && eventosPressao) {
                const quedaFim = eventosPressao.queda?.fim?.timestamp;
                const subidaFim = eventosPressao.subida?.fim?.timestamp;

                if (item.timestamp === quedaFim) {
                    data.cell.styles.fillColor = [255, 240, 214];
                    data.cell.styles.textColor = [138, 75, 0];
                    data.cell.styles.fontStyle = "bold";
                } else if (item.timestamp === subidaFim) {
                    data.cell.styles.fillColor = [228, 239, 255];
                    data.cell.styles.textColor = [20, 92, 170];
                    data.cell.styles.fontStyle = "bold";
                }
            }
        }
    });
}

function desenharResumoCaixa(doc, nome, dados, analise, inicioY = null) {
    let y = Number.isFinite(inicioY)
        ? inicioY
        : (doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 10 : 22);

    const alturaPagina = doc.internal.pageSize.getHeight();

    if (y > alturaPagina - 76) {
        doc.addPage();
        y = 20;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(35, 42, 49);
    doc.text(nome, 14, y);

    if (!dados.length) {
        doc.autoTable({
            startY: y + 4,
            head: [["Data", "Hora", "Nível", "Litros"]],
            body: [["-", "-", "Sem registros no período", "-"]],
            theme: "grid",
            styles: { fontSize: 5.8, cellPadding: 0.8, lineWidth: 0.08 },
            headStyles: {
                fillColor: [31, 36, 41],
                textColor: [239, 195, 83],
                fontStyle: "bold"
            },
            margin: { left: 14, right: 14, bottom: 16 }
        });

        return;
    }

    const larguraUtil = doc.internal.pageSize.getWidth() - 28;
    const gap = 2.5;
    const cardW = (larguraUtil - gap * 3) / 4;
    const cardH = 19;
    const cardY = y + 4;

    desenharCardResumo(
        doc, 14, cardY, cardW, cardH,
        "MENOR NÍVEL",
        `${analise.minimo.nivel.toFixed(1)} %`,
        formatarDataHoraCurta(analise.minimo.timestamp),
        [180, 35, 35]
    );

    desenharCardResumo(
        doc, 14 + cardW + gap, cardY, cardW, cardH,
        "MAIOR NÍVEL",
        `${analise.maximo.nivel.toFixed(1)} %`,
        formatarDataHoraCurta(analise.maximo.timestamp),
        [40, 112, 60]
    );

    desenharCardResumo(
        doc, 14 + 2 * (cardW + gap), cardY, cardW, cardH,
        "MAIOR QUEDA",
        analise.maiorQueda
            ? `- ${Math.abs(analise.maiorQueda.delta).toFixed(1)} pontos`
            : "--",
        analise.maiorQueda
            ? "Queda no nível da água (%)"
            : "Sem queda registrada",
        [180, 35, 35]
    );

    desenharCardResumo(
        doc, 14 + 3 * (cardW + gap), cardY, cardW, cardH,
        "MAIOR SUBIDA",
        analise.maiorSubida
            ? `+${Math.abs(analise.maiorSubida.delta).toFixed(1)} pontos`
            : "--",
        analise.maiorSubida
            ? "Aumento no nível da água (%)"
            : "Sem subida registrada",
        [40, 112, 60]
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    doc.setTextColor(90, 99, 108);

    doc.text(
        `Eventos: atenção ${analise.atencoes} • crítico ${analise.criticos} • recuperações ${analise.recuperacoes}`,
        14,
        cardY + cardH + 5
    );

    const linhas = dados.map(item => {
        const dh = formatarDataHora(item.timestamp);

        return [
            dh.data,
            dh.hora,
            `${item.nivel.toFixed(1)} %`,
            `${Math.round(item.litros)} L`
        ];
    });

    doc.autoTable({
        startY: cardY + cardH + 8,
        head: [["Data", "Hora", "Nível", "Litros"]],
        body: linhas,
        theme: "grid",
        styles: {
            fontSize: 5.7,
            cellPadding: 0.65,
            lineWidth: 0.08,
            valign: "middle"
        },
        headStyles: {
            fontSize: 6.1,
            fillColor: [31, 36, 41],
            textColor: [239, 195, 83],
            fontStyle: "bold"
        },
        alternateRowStyles: { fillColor: [247, 247, 247] },
        margin: { left: 14, right: 14, top: 12, bottom: 16 },

        didParseCell(data) {
            if (data.section !== "body" || data.column.index !== 2) return;

            const item = dados[data.row.index];
            if (!item) return;

            const evento = analise.eventosPorTimestamp.get(item.timestamp);
            const estado = statusNivel(item.nivel);

            if (evento === "recuperacao") {
                data.cell.styles.fillColor = [230, 244, 234];
                data.cell.styles.textColor = [40, 112, 60];
                data.cell.styles.fontStyle = "bold";
            } else if (estado === "critico") {
                data.cell.styles.fillColor = [255, 226, 226];
                data.cell.styles.textColor = [180, 35, 35];
                data.cell.styles.fontStyle = "bold";
            } else if (estado === "atencao") {
                data.cell.styles.fillColor = [255, 242, 204];
                data.cell.styles.textColor = [140, 95, 0];
                data.cell.styles.fontStyle = "bold";
            }
        }
    });
}

function desenharHistoricoChuva(doc, dados, estadoAtual) {
    let y = doc.lastAutoTable?.finalY
        ? doc.lastAutoTable.finalY + 10
        : 24;

    const alturaPagina = doc.internal.pageSize.getHeight();

    if (y > alturaPagina - 62) {
        doc.addPage();
        y = 22;
    }

    const analise = analisarHistoricoChuva(dados, estadoAtual);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(35, 42, 49);
    doc.text("Chuva no período", 14, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    doc.setTextColor(95, 95, 95);
    doc.text(
        "Eventos registrados pelo sensor de chuva no período selecionado.",
        14,
        y + 4
    );

    const larguraUtil = doc.internal.pageSize.getWidth() - 28;
    const gap = 2.5;
    const cardW = (larguraUtil - gap * 2) / 3;
    const cardH = 18;

    let resultado = "SEM REGISTROS";
    let detalheResultado = "Não há histórico suficiente para concluir";
    let corResultado = [120, 120, 120];

    if (analise.sensorIndisponivel) {
        resultado = "INDISPONÍVEL";
        detalheResultado = "Sensor de chuva sem monitoramento";
    } else if (!analise.semLeitura) {
        resultado = analise.houveChuva ? "SIM" : "NÃO";
        detalheResultado = analise.houveChuva
            ? "Chuva detectada no período"
            : "Nenhum evento de chuva detectado";

        corResultado = analise.houveChuva
            ? [20, 92, 170]
            : [40, 112, 60];
    }

    desenharCardResumo(
        doc, 14, y + 7, cardW, cardH,
        "CHOVEU?", resultado, detalheResultado, corResultado
    );

    desenharCardResumo(
        doc, 14 + cardW + gap, y + 7, cardW, cardH,
        "EPISÓDIOS",
        String(analise.episodios.length),
        analise.episodios.length === 1 ? "Evento de chuva" : "Eventos de chuva",
        [20, 92, 170]
    );

    desenharCardResumo(
        doc, 14 + 2 * (cardW + gap), y + 7, cardW, cardH,
        "ÚLTIMA CHUVA",
        analise.ultimoEventoChuva
            ? formatarDataHora(analise.ultimoEventoChuva.timestamp).data
            : "--",
        analise.ultimoEventoChuva
            ? formatarDataHora(analise.ultimoEventoChuva.timestamp).hora
            : "Sem registro",
        [199, 169, 91]
    );

    const linhas = analise.eventosPeriodo.map(item => {
        const dh = formatarDataHora(item.timestamp);
        const nome = item.status === "chuva"
            ? "Chuva"
            : item.status === "gotas"
                ? "Gotas"
                : "Seco";

        return [
            dh.data,
            dh.hora,
            nome,
            item.valor == null ? "-" : String(item.valor)
        ];
    });

    doc.autoTable({
        startY: y + 7 + cardH + 4,
        head: [["Data", "Hora", "Status", "Leitura"]],
        body: linhas.length
            ? linhas
            : [[
                "-",
                "-",
                analise.sensorIndisponivel
                    ? "Sensor indisponível"
                    : "Sem mudanças registradas",
                "-"
            ]],
        theme: "grid",
        styles: {
            fontSize: 5.7,
            cellPadding: 0.65,
            lineWidth: 0.08,
            valign: "middle"
        },
        headStyles: {
            fontSize: 6.1,
            fillColor: [31, 36, 41],
            textColor: [239, 195, 83],
            fontStyle: "bold"
        },
        alternateRowStyles: { fillColor: [247, 247, 247] },
        margin: { left: 14, right: 14, top: 12, bottom: 16 },

        didParseCell(data) {
            if (
                data.section !== "body" ||
                data.column.index !== 2 ||
                !linhas.length
            ) {
                return;
            }

            const item = analise.eventosPeriodo[data.row.index];
            if (!item) return;

            if (item.status === "chuva") {
                data.cell.styles.fillColor = [222, 238, 255];
                data.cell.styles.textColor = [20, 92, 170];
                data.cell.styles.fontStyle = "bold";
            } else if (item.status === "gotas") {
                data.cell.styles.fillColor = [232, 242, 255];
                data.cell.styles.textColor = [62, 100, 145];
            } else {
                data.cell.styles.fillColor = [235, 245, 238];
                data.cell.styles.textColor = [40, 112, 60];
            }
        }
    });
}

function desenharHistoricoEsp32(doc, dados) {
    let y = doc.lastAutoTable?.finalY
        ? doc.lastAutoTable.finalY + 12
        : 24;

    const alturaPagina = doc.internal.pageSize.getHeight();

    if (y > alturaPagina - 55) {
        doc.addPage();
        y = 22;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(35, 42, 49);
    doc.text("Histórico do ESP32", 14, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    doc.setTextColor(95, 95, 95);
    doc.text(
        "Mudanças de conexão registradas no período selecionado.",
        14,
        y + 4
    );

    if (!dados.length) {
        doc.autoTable({
            startY: y + 7,
            head: [["Evento", "Data", "Hora", "Duração offline"]],
            body: [["-", "-", "-", "Sem registros no período"]],
            theme: "grid",
            styles: { fontSize: 5.8, cellPadding: 0.8, lineWidth: 0.08 },
            headStyles: {
                fillColor: [31, 36, 41],
                textColor: [239, 195, 83],
                fontStyle: "bold"
            },
            margin: { left: 14, right: 14, bottom: 16 }
        });

        return;
    }

    const analise = analisarHistoricoEsp32(dados);
    const larguraUtil = doc.internal.pageSize.getWidth() - 28;
    const gap = 2.5;
    const cardW = (larguraUtil - gap) / 2;
    const cardH = 18;

    desenharCardResumo(
        doc, 14, y + 7, cardW, cardH,
        "QUEDAS DE CONEXÃO",
        String(analise.quedas),
        "Eventos offline registrados",
        [180, 35, 35]
    );

    desenharCardResumo(
        doc, 14 + cardW + gap, y + 7, cardW, cardH,
        "TEMPO OFFLINE",
        formatarDuracao(analise.totalOfflineSeg),
        "Soma das quedas com retorno registrado",
        [138, 75, 0]
    );

    const linhas = dados.map(item => {
        const dh = formatarDataHora(item.timestamp);

        const duracao = item.status === "offline"
            ? formatarDuracao(
                analise.duracaoPorTimestamp.get(item.timestamp)
            )
            : "-";

        return [
            item.status === "online" ? "Online" : "Offline",
            dh.data,
            dh.hora,
            duracao
        ];
    });

    doc.autoTable({
        startY: y + 7 + cardH + 4,
        head: [["Evento", "Data", "Hora", "Duração offline"]],
        body: linhas,
        theme: "grid",
        styles: {
            fontSize: 5.7,
            cellPadding: 0.65,
            lineWidth: 0.08,
            valign: "middle"
        },
        headStyles: {
            fontSize: 6.1,
            fillColor: [31, 36, 41],
            textColor: [239, 195, 83],
            fontStyle: "bold"
        },
        alternateRowStyles: { fillColor: [247, 247, 247] },
        margin: { left: 14, right: 14, top: 12, bottom: 16 },

        didParseCell(data) {
            if (data.section !== "body" || data.column.index !== 0) return;

            const item = dados[data.row.index];
            if (!item) return;

            if (item.status === "offline") {
                data.cell.styles.fillColor = [255, 226, 226];
                data.cell.styles.textColor = [180, 35, 35];
                data.cell.styles.fontStyle = "bold";
            } else {
                data.cell.styles.fillColor = [230, 244, 234];
                data.cell.styles.textColor = [40, 112, 60];
                data.cell.styles.fontStyle = "bold";
            }
        }
    });
}

function garantirEspacoResumo(doc, y, necessario = 45) {
    const altura = doc.internal.pageSize.getHeight();

    if (y > altura - necessario) {
        doc.addPage();
        return 22;
    }

    return y;
}

function desenharResumoChuvaCompacto(doc, dados, estadoAtual, inicioY) {
    const y = garantirEspacoResumo(doc, inicioY, 34);
    const analise = analisarHistoricoChuva(dados, estadoAtual);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(40, 47, 54);
    doc.text("Chuva", 14, y);

    const util = doc.internal.pageSize.getWidth() - 28;
    const gap = 2.5;
    const w = (util - gap * 2) / 3;

    let resultado = "SEM REGISTROS";
    let detalhe = "Sem histórico suficiente";
    let cor = [120, 120, 120];

    if (analise.sensorIndisponivel) {
        resultado = "INDISPONÍVEL";
        detalhe = "Sensor sem monitoramento";
    } else if (!analise.semLeitura) {
        resultado = analise.houveChuva ? "SIM" : "NÃO";
        detalhe = analise.houveChuva
            ? "Chuva detectada"
            : "Nenhum evento detectado";

        cor = analise.houveChuva
            ? [20, 92, 170]
            : [40, 112, 60];
    }

    desenharCardResumo(
        doc, 14, y + 4, w, 18,
        "CHOVEU?", resultado, detalhe, cor
    );

    desenharCardResumo(
        doc, 14 + w + gap, y + 4, w, 18,
        "EPISÓDIOS",
        String(analise.episodios.length),
        "Eventos registrados",
        [20, 92, 170]
    );

    desenharCardResumo(
        doc, 14 + 2 * (w + gap), y + 4, w, 18,
        "ÚLTIMA CHUVA",
        analise.ultimoEventoChuva
            ? formatarDataHora(analise.ultimoEventoChuva.timestamp).data
            : "--",
        analise.ultimoEventoChuva
            ? formatarDataHora(analise.ultimoEventoChuva.timestamp).hora
            : "Sem registro",
        [199, 169, 91]
    );

    return y + 27;
}

function desenharResumoCaixaCompacto(doc, nome, dados, inicioY) {
    const y = garantirEspacoResumo(doc, inicioY, 43);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(40, 47, 54);
    doc.text(nome, 14, y);

    if (!dados.length) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(105, 112, 119);
        doc.text("Sem registros no período.", 14, y + 6);
        return y + 14;
    }

    const a = analisarHistoricoCaixa(dados);
    const util = doc.internal.pageSize.getWidth() - 28;
    const gap = 2.5;
    const w = (util - gap * 3) / 4;

    desenharCardResumo(
        doc, 14, y + 4, w, 18,
        "MENOR NÍVEL",
        `${a.minimo.nivel.toFixed(1)} %`,
        formatarDataHoraCurta(a.minimo.timestamp),
        [180, 35, 35]
    );

    desenharCardResumo(
        doc, 14 + w + gap, y + 4, w, 18,
        "MAIOR NÍVEL",
        `${a.maximo.nivel.toFixed(1)} %`,
        formatarDataHoraCurta(a.maximo.timestamp),
        [40, 112, 60]
    );

    desenharCardResumo(
        doc, 14 + 2 * (w + gap), y + 4, w, 18,
        "MAIOR QUEDA",
        a.maiorQueda
            ? `- ${Math.abs(a.maiorQueda.delta).toFixed(1)} pontos`
            : "--",
        a.maiorQueda
            ? "Queda no nível da água (%)"
            : "Sem queda registrada",
        [180, 35, 35]
    );

    desenharCardResumo(
        doc, 14 + 3 * (w + gap), y + 4, w, 18,
        "MAIOR SUBIDA",
        a.maiorSubida
            ? `+${Math.abs(a.maiorSubida.delta).toFixed(1)} pontos`
            : "--",
        a.maiorSubida
            ? "Aumento no nível da água (%)"
            : "Sem subida registrada",
        [40, 112, 60]
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    doc.setTextColor(90, 99, 108);

    doc.text(
        `Eventos: atenção ${a.atencoes} • crítico ${a.criticos} • recuperações ${a.recuperacoes}`,
        14,
        y + 27
    );

    return y + 34;
}

function desenharResumoEsp32Compacto(doc, dados, inicioY) {
    const y = garantirEspacoResumo(doc, inicioY, 32);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(40, 47, 54);
    doc.text("Conectividade do ESP32", 14, y);

    if (!dados.length) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(105, 112, 119);
        doc.text(
            "Sem mudanças de conexão registradas no período.",
            14,
            y + 6
        );

        return y + 14;
    }

    const a = analisarHistoricoEsp32(dados);
    const util = doc.internal.pageSize.getWidth() - 28;
    const gap = 2.5;
    const w = (util - gap) / 2;

    desenharCardResumo(
        doc, 14, y + 4, w, 18,
        "QUEDAS DE CONEXÃO",
        String(a.quedas),
        "Eventos offline",
        [180, 35, 35]
    );

    desenharCardResumo(
        doc, 14 + w + gap, y + 4, w, 18,
        "TEMPO OFFLINE",
        formatarDuracao(a.totalOfflineSeg),
        "Quedas com retorno registrado",
        [138, 75, 0]
    );

    return y + 28;
}

async function gerarRelatorioPDF(modo = "completo") {
    const seletor = modo === "completo"
        ? "#gerar-relatorio-pdf-completo"
        : "#gerar-relatorio-pdf-resumido";

    const botao = document.querySelector(seletor);
    const textoOriginal = botao?.textContent || "PDF";

    if (!window.jspdf?.jsPDF) {
        alert("Não foi possível carregar o gerador de PDF. Verifique a conexão e tente novamente.");
        return;
    }

    if (typeof window.jspdf.jsPDF.API.autoTable !== "function") {
        alert("O componente de tabela do PDF não foi carregado. Atualize a página e tente novamente.");
        return;
    }

    try {
        if (botao) {
            botao.disabled = true;
            botao.textContent = "Gerando...";
        }

        const [
            caixaPrincipal,
            caixa1,
            caixa2,
            historicoChuva,
            estadoChuvaAtual,
            historicoEsp32,
            cabecalhoDataUrl
        ] = await Promise.all([
            buscarHistoricoCaixa(3),
            buscarHistoricoCaixa(1),
            buscarHistoricoCaixa(2),
            buscarHistoricoChuva(),
            buscarEstadoChuvaAtual(),
            buscarHistoricoEsp32(),
            carregarImagemComoDataURL("icons/cabecalho-sitio.png")
        ]);

        const dadosClima = filtrarHistorico();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: "portrait",
            unit: "mm",
            format: "a4"
        });

        adicionarCabecalhoRelatorio(doc, cabecalhoDataUrl);

        let y = desenharResumoClima(doc, dadosClima, 70);

        if (modo === "completo") {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.setTextColor(40, 47, 54);
            doc.text("Histórico de clima", 14, y);
            y += 4;

            doc.setFont("helvetica", "normal");
            doc.setFontSize(5.8);
            doc.setTextColor(95, 95, 95);

            doc.text(
                "Temperatura: azul abaixo da mínima média mensal • vermelho acima da máxima média mensal (INMET 1991–2020, ref. Uberaba/MG)",
                14,
                y
            );
            y += 3;

            doc.text(
                "Umidade: laranja em 30% ou menos • azul em 80% ou mais. Pressão: destaque nos maiores eventos de variação em 1 hora.",
                14,
                y
            );
            y += 4;

            const eventosPressao = encontrarVariacaoEmJanela(
                dadosClima,
                "pressao",
                60
            );

            tabelaClimaPDF(doc, dadosClima, y, eventosPressao);
            desenharHistoricoChuva(doc, historicoChuva, estadoChuvaAtual);

            doc.addPage();

            doc.setFont("helvetica", "bold");
            doc.setFontSize(15);
            doc.setTextColor(38, 45, 52);
            doc.text("Histórico das Caixas", 14, 22);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(6.5);
            doc.setTextColor(100, 106, 112);
            doc.text(
                "Leituras e eventos de nível registrados no período selecionado.",
                14,
                27
            );

            doc.setDrawColor(199, 169, 91);
            doc.setLineWidth(0.5);
            doc.line(14, 30, doc.internal.pageSize.getWidth() - 14, 30);

            desenharResumoCaixa(
                doc,
                "Caixa Principal",
                caixaPrincipal,
                analisarHistoricoCaixa(caixaPrincipal),
                38
            );

            desenharResumoCaixa(
                doc,
                "Caixa 1",
                caixa1,
                analisarHistoricoCaixa(caixa1)
            );

            desenharResumoCaixa(
                doc,
                "Caixa 2",
                caixa2,
                analisarHistoricoCaixa(caixa2)
            );

            desenharHistoricoEsp32(doc, historicoEsp32);
        } else {
            y = desenharResumoChuvaCompacto(
                doc,
                historicoChuva,
                estadoChuvaAtual,
                y
            );

            y = garantirEspacoResumo(doc, y + 2, 18);

            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(38, 45, 52);
            doc.text("Caixas d'água", 14, y);
            y += 6;

            y = desenharResumoCaixaCompacto(
                doc,
                "Caixa Principal",
                caixaPrincipal,
                y
            );

            y = desenharResumoCaixaCompacto(
                doc,
                "Caixa 1",
                caixa1,
                y
            );

            y = desenharResumoCaixaCompacto(
                doc,
                "Caixa 2",
                caixa2,
                y
            );

            y = desenharResumoEsp32Compacto(
                doc,
                historicoEsp32,
                y + 2
            );
        }

        adicionarRodapeRelatorio(doc);

        const hoje = new Date()
            .toLocaleDateString("pt-BR")
            .replaceAll("/", "-");

        doc.save(
            `${modo === "completo" ? "relatorio" : "resumo"}-SEU_PROJETO_FIREBASE-${periodoAtual}-${hoje}.pdf`
        );
    } catch (erro) {
        console.error("Erro ao gerar relatório PDF:", erro);
        alert("Não foi possível gerar o relatório. Tente novamente.");
    } finally {
        if (botao) {
            botao.disabled = false;
            botao.textContent = textoOriginal;
        }
    }
}

function labelsDoPeriodo(dados) {
    return dados.map(item => {
        const data = new Date(item.timestamp * 1000);

        if (periodoAtual === "24h") {
            return data.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit"
            });
        }

        return data.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit"
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
            mensagem.textContent = periodoAtual === "24h"
                ? "Sem dados nas últimas 24 horas."
                : periodoAtual === "7d"
                    ? "Sem dados nos últimos 7 dias."
                    : "Sem dados nos últimos 30 dias.";
        }

        Object.values(graficos).forEach(g => g?.destroy());

        graficos = {
            temperatura: null,
            umidade: null,
            pressao: null
        };

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

    criarGrafico(
        "temperatura",
        "#graficoTemperatura",
        labels,
        temperaturas,
        "Temperatura",
        "°C"
    );

    criarGrafico(
        "umidade",
        "#graficoUmidade",
        labels,
        umidades,
        "Umidade",
        "%"
    );

    criarGrafico(
        "pressao",
        "#graficoPressao",
        labels,
        pressoes,
        "Pressão",
        " hPa"
    );
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

            if (autoPdf === "completo" && !autoPdfDisparado) {
                autoPdfDisparado = true;

                setTimeout(async () => {
                    await gerarRelatorioPDF("completo");

                    if (window.opener) {
                        setTimeout(() => window.close(), 400);
                    }
                }, 250);
            }
        });

        document.querySelectorAll(".filtro").forEach(botao => {
            botao.classList.toggle(
                "ativo",
                botao.dataset.periodo === periodoAtual
            );

            botao.addEventListener("click", () => {
                document.querySelectorAll(".filtro").forEach(b => {
                    b.classList.remove("ativo");
                });

                botao.classList.add("ativo");
                periodoAtual = botao.dataset.periodo;
                atualizarGraficos();
            });
        });

        document
            .querySelector("#gerar-relatorio-pdf-completo")
            ?.addEventListener("click", () => gerarRelatorioPDF("completo"));

        document
            .querySelector("#gerar-relatorio-pdf-resumido")
            ?.addEventListener("click", () => gerarRelatorioPDF("resumido"));

        setInterval(() => {
            atualizarStatusEsp32();
        }, 5000);
    })
    .catch(erro => {
        console.error("❌ Erro na autenticação do clima:", erro);

        const el = document.querySelector("#conexao-detalhes");

        if (el) {
            el.textContent = "🔴 Erro de autenticação";
        }
    });
