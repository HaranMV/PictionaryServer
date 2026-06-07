
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

let tiempo = 60;



document.addEventListener("DOMContentLoaded", () => {

    iniciarVista();

});

function iniciarVista() {

    if (document.querySelector(".formulario")) {

        iniciarIndex();

    }

    if (document.querySelector(".opciones")) {

        iniciarPalabras();

    }

    if (document.querySelector(".contenido")) {

        iniciarJuego();

    }

    if (document.querySelector(".tabla")) {

        iniciarResultados();

    }

}


function iniciarIndex() {

    const formulario = document.querySelector(".formulario");

    formulario.addEventListener("submit", (e) => {

        e.preventDefault();

        const jugador = nombre.value.trim();

        if (jugador === "") {

            alert("Ingresa un nombre");

            return;
        }

        console.log("Jugador:", jugador);

      

    });

}


function iniciarPalabras() {

    const opciones = document.querySelectorAll(".opcion");

    opciones.forEach(opcion => {

        opcion.addEventListener("click", () => {

            const palabraElegida = opcion.textContent;

            console.log("Palabra:", palabraElegida);


        });

    });

}



function iniciarJuego() {

    iniciarChat();
    iniciarTemporizador();

    if (pizarra) {

        iniciarPizarra();

    }

}


function iniciarChat() {

    const botonEnviar =
        document.querySelector(".boton-enviar");

    if (!botonEnviar) return;

    botonEnviar.addEventListener("click", enviarRespuesta);

    respuesta.addEventListener("keypress", (e) => {

        if (e.key === "Enter") {

            enviarRespuesta();

        }

    });

}

function enviarRespuesta() {

    const texto = respuesta.value.trim();

    if (texto === "") return;

    agregarMensaje("Yo merengues", texto);

    respuesta.value = "";

  

}

function agregarMensaje(usuario, texto) {

    if (!mensajes) return;

    const div = document.createElement("div");

    div.classList.add("mensaje");

    div.textContent = `${usuario}: ${texto}`;

    mensajes.appendChild(div);

    mensajes.scrollTop =
        mensajes.scrollHeight;

}


function iniciarTemporizador() {

    if (!contador) return;

    contador.textContent = tiempo;

    setInterval(() => {

        tiempo--;

        contador.textContent = tiempo;

        if (tiempo <= 0) {

            tiempo = 0;

        }

    }, 1000);

}



function iniciarPizarra() {

    const contexto = pizarra.getContext("2d");

    let dibujando = false;

    pizarra.addEventListener("mousedown", () => {

        dibujando = true;

    });

    pizarra.addEventListener("mouseup", () => {

        dibujando = false;

        contexto.beginPath();

    });

    pizarra.addEventListener("mousemove", dibujar);

    function dibujar(e) {

        if (!dibujando) return;

        const rect = pizarra.getBoundingClientRect();

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        contexto.lineWidth = 3;

        contexto.lineCap = "round";

        contexto.lineTo(x, y);

        contexto.stroke();

        contexto.beginPath();

        contexto.moveTo(x, y);

 

    }

}


function iniciarResultados() {

    const boton =
        document.querySelector(".boton-principal");

    if (!boton) return;

    boton.addEventListener("click", () => {

        console.log("Nueva partida");


    });

}

