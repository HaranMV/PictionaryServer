const nombre = document.getElementById("nombre");
const mensajes = document.getElementById("mensajes");
const respuesta = document.getElementById("respuesta");
const turno = document.getElementById("turno");
const puntos = document.getElementById("puntos");
const letras = document.getElementById("letras");
const palabra = document.getElementById("palabra");
const contador = document.querySelector(".contador");
const pizarra = document.getElementById("pizarra");
const infoLetras = document.getElementById("info-letras");
const infoPalabra = document.getElementById("info-palabra");
const estado = document.querySelector(".estado");

const sonidoAcierto = new Audio("sound/acierto.mp3");
const sonidoFinal = new Audio("sound/findepartida.mp3");

const pagina = location.pathname.split("/").pop() || "index.html";
const idSesionKey = "pictionary_id_sesion";
const nombreKey = "pictionary_nombre";
const resultadosKey = "pictionary_resultados";
const rondaKey = "pictionary_ronda_actual";
const opcionesKey = "pictionary_opciones";
const segundosPalabraKey = "pictionary_segundos_palabra";
const sesion = window.sessionStorage;

let esDibujante = false;
let puedeDibujar = false;
let colorActual = "#000000";
let grosorActual = 3;
let ultimoPunto = null;
let contexto = null;
let conexionIniciada = false;
let connection = null;
let rondaRecibida = false;
let sincronizador = null;
let rondaActualCliente = "";
let timerVisual = null;
let segundosVisuales = 0;
let finContadorVisual = 0;

document.addEventListener("DOMContentLoaded", async () => {
    if (!window.signalR) {
        iniciarVista();
        mostrarEstado("No se pudo cargar SignalR. Revisa tu conexion a internet");
        habilitarFormulario(false);
        return;
    }

    connection = new signalR.HubConnectionBuilder()
        .withUrl("/pictioHub")
        .configureLogging(signalR.LogLevel.Information)
        .withAutomaticReconnect()
        .build();

    registrarEventosServidor();
    iniciarVista();
    await conectarServidor();
    iniciarSincronizacion();
});

function iniciarVista() {
    if (document.querySelector(".formulario")) iniciarIndex();
    if (document.querySelector(".opciones")) iniciarPalabras();
    if (document.querySelector(".contenido")) iniciarJuego();
    if (document.querySelector(".tabla")) iniciarResultados();
}

async function conectarServidor() {
    if (!connection) return false;

    try {
        if (connection.state === signalR.HubConnectionState.Disconnected) {
            await connection.start();
        }

        conexionIniciada = true;

        if (pagina !== "index.html") {
            const jugador = sesion.getItem(nombreKey);

            if (!jugador) {
                location.href = "index.html";
                return;
            }

            await connection.invoke("Conectar", obtenerIdSesion(), jugador);
            await sincronizarEstado();
        }

        return true;
    } catch (error) {
        console.log(error);
        mostrarEstado("No se pudo conectar con el servidor. Reintentando...");
        setTimeout(conectarServidor, 2000);
        return false;
    }
}

function registrarEventosServidor() {
    connection.on("NombreRepetido", (mensaje) => {
        mostrarEstado(mensaje);
        habilitarFormulario(true);
    });

    connection.on("ConexionAceptada", (jugador, enPartida) => {
        sesion.setItem(nombreKey, jugador);

        if (pagina === "index.html" && enPartida) {
            location.href = "juego.html";
        }
    });

    connection.on("EsperandoPartida", (mensaje) => {
        sesion.removeItem(rondaKey);
        mostrarEstado(mensaje);
        mostrarEstadoJuego(mensaje);
        habilitarFormulario(false);
    });

    connection.on("EsperandoJugadores", () => {
        sesion.removeItem(rondaKey);
        rondaActualCliente = "";
        detenerContadorVisual();
        mostrarEstado("Esperando a que se unan minimo 2 jugadores...");
        agregarMensaje("Sistema", "Esperando a que haya suficientes jugadores.");
        bloquearControles();
    });

    connection.on("LobbyActualizado", (segundos, jugadores) => {
        sesion.removeItem(rondaKey);
        rondaActualCliente = "";
        mostrarEstado(`La partida inicia en ${segundos} segundos.`);
        iniciarContadorVisual(segundos);
        actualizarPuntajes(jugadores);
        bloquearControles();
        agregarMensajeSistemaUnaVez("lobby", "Esperando a mas jugadores. Los controles estan bloqueados.");
    });

    connection.on("PalabrasParaElegir", (opciones, segundos) => {
        sesion.removeItem(rondaKey);
        rondaActualCliente = "";
        sesion.setItem(opcionesKey, JSON.stringify(opciones));
        sesion.setItem(segundosPalabraKey, segundos);

        if (pagina !== "palabra.html") {
            location.href = "palabra.html";
            return;
        }

        pintarOpciones(opciones);
        iniciarContadorVisual(segundos);
    });

    connection.on("TimerSeleccion", (segundos) => {
        mostrarMensajeSeleccion("Es tu turno de dibujar selecciona una palabra");
        sincronizarContadorVisual(segundos);
    });

    connection.on("SeleccionNoValida", (mensaje) => {
        mostrarMensajeSeleccion(mensaje);
        bloquearOpciones(false);
    });

    connection.on("EsperandoDibujante", (dibujante, ronda, total, segundos) => {
        sesion.removeItem(rondaKey);
        rondaActualCliente = "";

        if (pagina !== "juego.html") {
            location.href = "juego.html";
            return;
        }

        bloquearControles();
        iniciarContadorVisual(segundos);
        if (turno) turno.textContent = `${dibujante} elige palabra (${ronda}/${total})`;
        agregarMensajeSistemaUnaVez("seleccion", `${dibujante} esta seleccionando palabra.`);
    });

    connection.on("EsperandoSiguienteRonda", (mensaje) => {
        sesion.removeItem(rondaKey);
        rondaActualCliente = "";
        detenerContadorVisual();

        if (pagina !== "juego.html") {
            location.href = "juego.html";
            return;
        }

        bloquearControles();
        if (turno) turno.textContent = "Preparando siguiente ronda";
        agregarMensajeSistemaUnaVez("siguienteRonda", mensaje);
    });

    connection.on("RondaIniciada", (dibujante, palabraAsignada, cantidadLetras, ronda, total, segundos, soyDibujante) => {
        rondaRecibida = true;
        sesion.removeItem(opcionesKey);
        sesion.removeItem(segundosPalabraKey);
        guardarRondaActual(dibujante, palabraAsignada, cantidadLetras, ronda, total, segundos, soyDibujante);

        if (pagina === "palabra.html") {
            location.href = "juego.html";
            return;
        }

        aplicarRonda(dibujante, palabraAsignada, cantidadLetras, ronda, total, segundos, soyDibujante);
    });

    connection.on("TimerRonda", (segundos) => {
        sincronizarContadorVisual(segundos);
    });

    connection.on("TrazoRecibido", (x1, y1, x2, y2, color, grosor) => {
        dibujarLinea(x1, y1, x2, y2, color, grosor);
    });

    connection.on("MensajeRecibido", (usuario, texto) => {
        agregarMensaje(usuario, texto);
    });

    connection.on("Acierto", (jugador, puntosGanados) => {
        sonidoAcierto.play().catch(() => { });
        puedeDibujar = false;
        agregarMensaje("Sistema", `${jugador} adivino y obtuvo ${puntosGanados} puntos.`);
        bloquearControles();
    });

    connection.on("TiempoTerminado", (palabraCorrecta) => {
        sesion.removeItem(rondaKey);
        rondaActualCliente = "";
        detenerContadorVisual();
        puedeDibujar = false;
        agregarMensaje("Sistema", `Tiempo terminado. La palabra era ${palabraCorrecta}.`);
        bloquearControles();
    });

    connection.on("PuntajesActualizados", (jugadores) => {
        actualizarPuntajes(jugadores);
    });

    connection.on("PartidaFinalizada", (resultados) => {
        sesion.removeItem(rondaKey);
        rondaActualCliente = "";
        detenerContadorVisual();
        localStorage.setItem(resultadosKey, JSON.stringify(resultados));
        sonidoFinal.play().catch(() => { });

        if (pagina !== "resultados.html") {
            location.href = "resultados.html";
            return;
        }

        pintarResultados(resultados);
    });

    connection.on("NuevaPartida", () => {
        location.href = "juego.html";
    });

    connection.onreconnected(async () => {
        const jugador = sesion.getItem(nombreKey);
        agregarMensaje("Sistema", "Conexion restaurada.");

        if (jugador) {
            await connection.invoke("Conectar", obtenerIdSesion(), jugador);
        }
    });

    connection.onreconnecting(() => {
        mostrarEstadoJuego("Servidor desconectado. Intentando reconectar...");
        bloquearControles();
        bloquearOpciones(true);
    });

    connection.onclose(() => {
        mostrarEstadoJuego("Se perdio la conexion con el servidor. Reinicia el servidor y vuelve a entrar a la partida.");
        bloquearControles();
        bloquearOpciones(true);
    });
}

function iniciarIndex() {
    const formulario = document.querySelector(".formulario");
    habilitarFormulario(true);

    formulario.addEventListener("submit", async (e) => {
        e.preventDefault();

        const jugador = nombre.value.trim();

        if (jugador === "") {
            mostrarEstado("Ingresa un nombre");
            return;
        }

        prepararSesionParaNombre(jugador);
        sesion.setItem(nombreKey, jugador);
        habilitarFormulario(false);
        mostrarEstado("Conectando...");

        if (!conexionIniciada) {
            const conectado = await conectarServidor();

            if (!conectado) {
                habilitarFormulario(true);
                return;
            }
        }

        try {
            await connection.invoke("Conectar", obtenerIdSesion(), jugador);
        } catch (error) {
            console.log(error);
            mostrarEstado("No se pudo registrar tu nombre. Intenta de nuevo.");
            habilitarFormulario(true);
        }
    });
}

function iniciarPalabras() {
    const opcionesGuardadas = JSON.parse(sesion.getItem(opcionesKey) || "[]");
    const segundos = sesion.getItem(segundosPalabraKey) || "10";

    if (opcionesGuardadas.length > 0)
        pintarOpciones(opcionesGuardadas);

    iniciarContadorVisual(segundos);
}

function iniciarJuego() {
    iniciarChat();
    iniciarPizarra();
    bloquearControles();
    aplicarRondaGuardada();
}

function iniciarChat() {
    const botonEnviar = document.querySelector(".boton-enviar");

    if (!botonEnviar || !respuesta) return;

    botonEnviar.addEventListener("click", enviarRespuesta);

    respuesta.addEventListener("keypress", (e) => {
        if (e.key === "Enter") enviarRespuesta();
    });
}

async function enviarRespuesta() {
    const texto = respuesta.value.trim();

    if (texto === "" || esDibujante) return;

    await connection.invoke("EnviarRespuesta", texto);
    respuesta.value = "";
}

function agregarMensaje(usuario, texto) {
    if (!mensajes) return;

    const div = document.createElement("div");
    div.classList.add("mensaje");
    div.textContent = `${usuario}: ${texto}`;

    mensajes.appendChild(div);
    mensajes.scrollTop = mensajes.scrollHeight;
}

function agregarMensajeSistemaUnaVez(clave, texto) {
    if (!mensajes || mensajes.dataset[clave]) return;

    mensajes.dataset[clave] = "1";
    agregarMensaje("Sistema", texto);
}

function iniciarPizarra() {
    if (!pizarra) return;

    contexto = pizarra.getContext("2d");
    limpiarPizarra();
    configurarColores();

    pizarra.addEventListener("pointerdown", (e) => {
        if (!puedeDibujar) return;

        pizarra.setPointerCapture(e.pointerId);
        ultimoPunto = obtenerPunto(e);
    });

    pizarra.addEventListener("pointerup", () => {
        ultimoPunto = null;
    });

    pizarra.addEventListener("pointerleave", () => {
        ultimoPunto = null;
    });

    pizarra.addEventListener("pointermove", (e) => {
        if (!puedeDibujar || !ultimoPunto) return;

        const punto = obtenerPunto(e);
        dibujarLinea(ultimoPunto.x, ultimoPunto.y, punto.x, punto.y, colorActual, grosorActual);

        connection
            .invoke("EnviarTrazo", ultimoPunto.x, ultimoPunto.y, punto.x, punto.y, colorActual, grosorActual)
            .catch(error => console.log(error));

        ultimoPunto = punto;
    });
}

function configurarColores() {
    const botones = document.querySelectorAll(".color");

    botones.forEach((boton) => {
        boton.addEventListener("click", () => {
            colorActual = getComputedStyle(boton).backgroundColor;
        });
    });
}

function obtenerPunto(e) {
    const rect = pizarra.getBoundingClientRect();

    return {
        x: (e.clientX - rect.left) * (pizarra.width / rect.width),
        y: (e.clientY - rect.top) * (pizarra.height / rect.height)
    };
}

function dibujarLinea(x1, y1, x2, y2, color, grosor) {
    if (!contexto) return;

    contexto.beginPath();
    contexto.strokeStyle = color;
    contexto.lineWidth = grosor;
    contexto.lineCap = "round";
    contexto.moveTo(x1, y1);
    contexto.lineTo(x2, y2);
    contexto.stroke();
}

function limpiarPizarra() {
    if (!pizarra) return;

    contexto = contexto || pizarra.getContext("2d");
    contexto.fillStyle = "#F5F5F5";
    contexto.fillRect(0, 0, pizarra.width, pizarra.height);
}

function iniciarResultados() {
    const boton = document.querySelector(".boton-principal");
    const resultados = JSON.parse(localStorage.getItem(resultadosKey) || "[]");

    pintarResultados(resultados);

    if (!boton) return;

    boton.addEventListener("click", async () => {
        if (!conexionIniciada)
            await conectarServidor();

        await connection.invoke("ReiniciarJuego");
    });
}

function pintarOpciones(opciones) {
    const contenedor = document.querySelector(".opciones");

    if (!contenedor) return;

    contenedor.innerHTML = "";

    opciones.forEach((texto) => {
        const boton = document.createElement("button");
        boton.classList.add("opcion");
        boton.textContent = texto;
        boton.addEventListener("click", async () => {
            const palabraSeleccionada = texto.trim();

            bloquearOpciones(true);
            mostrarMensajeSeleccion("Iniciando ronda...");

            try {
                const aceptada = await connection.invoke("SeleccionarPalabra", palabraSeleccionada);

                if (aceptada) {
                    navegarAJuegoSiNoLlegaRonda();
                } else {
                    bloquearOpciones(false);
                }
            } catch (error) {
                console.log(error);
                mostrarMensajeSeleccion("No se pudo seleccionar la palabra. Intenta de nuevo.");
                bloquearOpciones(false);
            }
        });

        contenedor.appendChild(boton);
    });
}

function pintarResultados(resultados) {
    const cuerpo = document.querySelector(".tabla tbody");

    if (!cuerpo) return;

    cuerpo.innerHTML = "";

    resultados.forEach((jugador, i) => {
        const fila = document.createElement("tr");
        const ganador = i === 0 ? " *" : "";

        fila.innerHTML = `
            <td>${jugador.lugar}</td>
            <td>${jugador.nombre}${ganador}</td>
            <td>${jugador.puntos}</td>
        `;

        cuerpo.appendChild(fila);
    });
}

function actualizarPuntajes(jugadores) {
    if (!puntos || !jugadores) return;

    puntos.textContent = jugadores
        .map(jugador => `${jugador.nombre}: ${jugador.puntos}`)
        .join(" | ");
}

function actualizarContador(valor) {
    if (contador) contador.textContent = Math.max(0, Number(valor));
}

function iniciarContadorVisual(valor) {
    detenerContadorVisual();
    segundosVisuales = normalizarSegundos(valor);
    finContadorVisual = Date.now() + segundosVisuales * 1000;
    actualizarContador(segundosVisuales);

    if (segundosVisuales > 0)
        timerVisual = setInterval(actualizarContadorDesdeReloj, 250);
}

function sincronizarContadorVisual(valor) {
    segundosVisuales = normalizarSegundos(valor);
    finContadorVisual = Date.now() + segundosVisuales * 1000;
    actualizarContador(segundosVisuales);

    if (segundosVisuales <= 0)
        detenerContadorVisual();
    else if (!timerVisual)
        timerVisual = setInterval(actualizarContadorDesdeReloj, 250);
}

function detenerContadorVisual() {
    if (!timerVisual) return;

    clearInterval(timerVisual);
    timerVisual = null;
}

function actualizarContadorDesdeReloj() {
    segundosVisuales = Math.max(0, Math.ceil((finContadorVisual - Date.now()) / 1000));
    actualizarContador(segundosVisuales);

    if (segundosVisuales <= 0)
        detenerContadorVisual();
}

function normalizarSegundos(valor) {
    const segundos = Number(valor);
    return Number.isFinite(segundos) ? Math.max(0, segundos) : 0;
}

function bloquearControles() {
    puedeDibujar = false;

    if (respuesta) {
        respuesta.disabled = true;
        respuesta.placeholder = "Espera tu turno...";
    }

    const herramientas = document.querySelector(".herramientas");
    if (herramientas) herramientas.classList.add("oculto");
}

function mostrarEstado(texto) {
    if (estado) estado.textContent = texto;
}

function mostrarEstadoJuego(texto) {
    mostrarEstado(texto);
    agregarMensaje("Sistema", texto);
    mostrarMensajeSeleccion(texto);
}

function habilitarFormulario(habilitado) {
    const boton = document.querySelector(".boton-principal");

    if (nombre) nombre.disabled = !habilitado;
    if (boton) boton.disabled = !habilitado;
}

function obtenerIdSesion() {
    let id = sesion.getItem(idSesionKey);

    if (!id) {
        id = globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        sesion.setItem(idSesionKey, id);
    }

    return id;
}

function prepararSesionParaNombre(jugador) {
    const nombreAnterior = sesion.getItem(nombreKey);

    if (nombreAnterior && nombreAnterior.toLowerCase() !== jugador.toLowerCase()) {
        sesion.removeItem(idSesionKey);
        sesion.removeItem(rondaKey);
    }
}

function guardarRondaActual(dibujante, palabraAsignada, cantidadLetras, ronda, total, segundos, soyDibujante) {
    sesion.setItem(rondaKey, JSON.stringify({
        dibujante,
        palabraAsignada,
        cantidadLetras,
        ronda,
        total,
        segundos,
        soyDibujante
    }));
}

function aplicarRondaGuardada() {
    const datos = JSON.parse(sesion.getItem(rondaKey) || "null");

    if (!datos) return;

    aplicarRonda(
        datos.dibujante,
        datos.palabraAsignada,
        datos.cantidadLetras,
        datos.ronda,
        datos.total,
        datos.segundos,
        datos.soyDibujante
    );
}

function aplicarRonda(dibujante, palabraAsignada, cantidadLetras, ronda, total, segundos, soyDibujante) {
    const claveRonda = `${ronda}-${total}-${dibujante}-${soyDibujante}`;

    if (rondaActualCliente === claveRonda) {
        sincronizarContadorVisual(segundos);
        return;
    }

    rondaActualCliente = claveRonda;
    esDibujante = soyDibujante;
    puedeDibujar = soyDibujante;
    limpiarPizarra();
    iniciarContadorVisual(segundos);

    if (turno) turno.textContent = `${dibujante} (${ronda}/${total})`;
    if (letras) letras.textContent = cantidadLetras;
    if (palabra) palabra.textContent = palabraAsignada;

    if (infoPalabra) infoPalabra.classList.toggle("oculto", !soyDibujante);
    if (infoLetras) infoLetras.classList.toggle("oculto", soyDibujante);

    const herramientas = document.querySelector(".herramientas");
    if (herramientas) herramientas.classList.toggle("oculto", !soyDibujante);

    if (respuesta) {
        respuesta.disabled = soyDibujante;
        respuesta.placeholder = soyDibujante ? "Estas dibujando..." : "Escribe...";
    }

    agregarMensaje("Sistema", soyDibujante ? "Es tu turno de dibujar." : `Adivina la palabra de ${dibujante}.`);
}

function bloquearOpciones(bloqueado) {
    document.querySelectorAll(".opcion").forEach((boton) => {
        boton.disabled = bloqueado;
    });
}

function mostrarMensajeSeleccion(texto) {
    const mensaje = document.querySelector(".mensaje2 p");

    if (mensaje) mensaje.textContent = texto;
}

function navegarAJuegoSiNoLlegaRonda() {
    setTimeout(() => {
        if (pagina === "palabra.html" && !rondaRecibida) {
            location.href = "juego.html";
        }
    }, 1000);
}

function iniciarSincronizacion() {
    if (pagina === "index.html" || sincronizador) return;

    sincronizarEstado();

    if (pagina === "palabra.html") {
        sincronizador = setInterval(sincronizarEstado, 3000);
    }
}

async function sincronizarEstado() {
    if (!connection || connection.state !== signalR.HubConnectionState.Connected) return;

    try {
        await connection.invoke("ReenviarEstado");
    } catch (error) {
        console.log(error);
    }
}
