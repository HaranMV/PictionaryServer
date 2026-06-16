using Microsoft.AspNetCore.SignalR;
using PictionaryServer.Hubs;
using PictionaryServer.Models;
using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace PictionaryServer.Services
{
    public class PictionaryService
    {
        private readonly IHubContext<GameHub> hub;
        private readonly object candado = new();
        private readonly Random random = new();

        public static ConcurrentDictionary<string, Jugador> Jugadores { get; set; } = new();

        Timer? timerLobby;
        Timer? timerSeleccion;
        Timer? timerRonda;
        Timer? timerSiguienteRonda;

        string estado = "Lobby";
        int segundosLobby;
        int segundosSeleccion;
        int segundosRonda;
        int rondaActual;
        string? idDibujante;
        string palabraActual = "";
        string[] opcionesActuales = [];
        List<string> turnosPendientes = [];

        int SegundosEspera = 30;
        int SegundosPalabra = 10;
        int SegundosDibujo = 60;
        int TotalRondas = 5;
        int MaximoJugadores = 5;

        private readonly string[] palabras =
        [
            "Manzana", "Casa", "Perro", "Gato", "Avion", "Barco", "Sol", "Luna",
            "Estrella", "Arbol", "Flor", "Zapato", "Sombrero", "Camion", "Bicicleta",
            "Helado", "Pizza", "Computadora", "Telefono", "Libro", "Reloj", "Puente",
            "Castillo", "Robot", "Fantasma", "Dinosaurio", "Mariposa", "Guitarra",
            "Balon", "Corona", "Montana", "Nube", "Tren", "Carro", "Pez", "Taza",
            "Llave", "Cama", "Silla", "Mesa", "Lampara", "Camara", "Tortuga"
        ];

        public PictionaryService(IHubContext<GameHub> hub)
        {
            this.hub = hub;
        }

        public async Task Conectar(string idConexion, string idSesion, string nombre)
        {
            nombre = nombre.Trim();

            Jugador? jugador;
            bool nombreRepetido;
            bool reconectado;
            bool salaLlena;
            bool iniciarTimer;

            lock (candado)
            {
                jugador = PrepararJugador(idConexion, idSesion, nombre, out nombreRepetido, out reconectado, out salaLlena);
                iniciarTimer = estado == "Lobby" && JugadoresEnPartida().Count >= 2;
            }

            if (salaLlena)
            {
                await hub.Clients.Client(idConexion).SendAsync("EsperandoPartida", "La sala ya tiene el maximo de 5 jugadores. Intenta cuando termine la partida.");
                return;
            }

            if (nombreRepetido)
            {
                await hub.Clients.Client(idConexion).SendAsync("NombreRepetido", "Ese nombre ya esta en uso");
                return;
            }

            if (jugador == null)
                return;

            await hub.Clients.Client(idConexion).SendAsync("ConexionAceptada", jugador.Nombre, jugador.EnPartida);

            if (reconectado)
                await hub.Clients.Client(idConexion).SendAsync("MensajeRecibido", "Sistema", "Te reconectaste a la partida.");

            if (!jugador.EnPartida)
            {
                await hub.Clients.Client(idConexion).SendAsync("EsperandoPartida", "La ronda ya comenzo. Espera a que termine para entrar.");
                return;
            }

            if (iniciarTimer)
                await IniciarCuentaRegresiva();

            await EnviarEstadoActual(jugador);
            await EnviarPuntajes();
        }

        public async Task Desconectar(string idConexion)
        {
            lock(candado)
            {
                var jugador = BuscarPorConexion(idConexion);

                if(jugador != null)
                {
                    jugador.Conectado = false;
                    jugador.IdConexion = null;
                }
            }

            await EnviarPuntajes();
        }

        public async Task<bool> SeleccionarPalabra(string idConexion, string palabra)
        {
            bool puedeElegir;
            Jugador? jugador;

            palabra = palabra.Trim();

            lock (candado)
            {
                jugador = BuscarPorConexion(idConexion);
                puedeElegir = estado == "SeleccionPalabra" &&
                    jugador != null &&
                    jugador.IdSesion == idDibujante &&
                    opcionesActuales.Any(x => x.Equals(palabra, StringComparison.OrdinalIgnoreCase));
            }

            if (puedeElegir)
            {
                await IniciarRonda(palabra);
                return true;
            }

            await hub.Clients.Client(idConexion).SendAsync("SeleccionNoValida", "No se pudo seleccionar esa palabra. Intenta de nuevo.");

            if (jugador != null)
                await EnviarEstadoActual(jugador);

            return false;
        }

        public async Task ReenviarEstado(string idConexion)
        {
            var jugador = BuscarPorConexion(idConexion);

            if (jugador == null)
                return;

            await EnviarEstadoActual(jugador);
            await EnviarPuntajes();
        }

        public async Task EnviarTrazo(string idConexion, double x1, double y1, double x2, double y2, string color, int grosor)
        {
            bool puedeDibujar;
            List<string> conexiones;

            lock (candado)
            {
                var jugador = BuscarPorConexion(idConexion);
                puedeDibujar = estado == "Dibujando" && jugador != null && jugador.IdSesion == idDibujante;
                conexiones = ConexionesEnPartida().Where(x => x != idConexion).ToList();
            }

            if (puedeDibujar && conexiones.Count > 0)
                await hub.Clients.Clients(conexiones).SendAsync("TrazoRecibido", x1, y1, x2, y2, color, grosor);
        }

        public async Task EnviarRespuesta(string idConexion, string texto)
        {
            Jugador? jugador;
            bool acerto;
            int puntosGanados = 0;
            string palabra;

            lock (candado)
            {
                jugador = BuscarPorConexion(idConexion);

                if (jugador == null || !PuedeResponder(jugador))
                    return;

                acerto = Normalizar(texto) == Normalizar(palabraActual);
                palabra = palabraActual;

                if (acerto)
                    puntosGanados = RegistrarAcierto(jugador);
            }

            if (!acerto)
            {
                await EnviarMensaje(jugador.Nombre, texto);
                return;
            }

            DetenerTimerRonda();

            await EnviarMensaje("Sistema", $"{jugador.Nombre} adivino la palabra y obtuvo {puntosGanados} puntos");
            await hub.Clients.Clients(ConexionesEnPartida()).SendAsync("Acierto", jugador.Nombre, puntosGanados, palabra);
            await EnviarPuntajes();
            await ProgramarSiguienteRonda();
        }

        public async Task ReiniciarJuego()
        {
            bool puedeIniciar;

            lock (candado)
            {
                puedeIniciar = estado == "Finalizado" && Jugadores.Values.Count(x => x.Conectado) >= 2;

                if (puedeIniciar)
                    PrepararNuevaPartida();
            }

            if (puedeIniciar)
            {
                await hub.Clients.Clients(ConexionesEnPartida()).SendAsync("NuevaPartida");
                await IniciarCuentaRegresiva();
            }
        }

        private Jugador? PrepararJugador(string idConexion, string idSesion, string nombre, out bool nombreRepetido, out bool reconectado, out bool salaLlena)
        {
            nombreRepetido = false;
            reconectado = false;
            salaLlena = false;

            var jugador = BuscarDesconectadoPorNombre(nombre);

            if (jugador != null)
            {
                ReconectarJugador(jugador, idConexion, idSesion, nombre);
                reconectado = true;
                return jugador;
            }

            if (NombreEnUso(idSesion, nombre))
            {
                nombreRepetido = true;
                return null;
            }

            if (Jugadores.TryGetValue(idSesion, out jugador))
            {
                jugador.IdConexion = idConexion;
                jugador.Conectado = true;
                jugador.Nombre = nombre;
                return jugador;
            }

            if (SalaLlena())
            {
                salaLlena = true;
                return null;
            }

            jugador = new Jugador
            {
                IdSesion = idSesion,
                IdConexion = idConexion,
                Nombre = nombre,
                Conectado = true,
                EnPartida = PuedeEntrarALaPartida()
            };

            Jugadores[idSesion] = jugador;

            return jugador;
        }

        private void ReconectarJugador(Jugador jugador, string idConexion, string idSesion, string nombre)
        {
            if (jugador.IdSesion != idSesion)
                CambiarSesionJugador(jugador, idSesion);

            jugador.IdConexion = idConexion;
            jugador.Conectado = true;
            jugador.Nombre = nombre;
        }

        private bool NombreEnUso(string idSesion, string nombre)
        {
            return Jugadores.Values.Any(x => x.Conectado &&
                x.IdSesion != idSesion &&
                x.Nombre.Equals(nombre, StringComparison.OrdinalIgnoreCase));
        }

        private bool PuedeEntrarALaPartida()
        {
            return estado == "Lobby" ||
                estado == "CuentaRegresiva" ||
                estado == "EntreRondas" ||
                estado == "Finalizado";
        }

        private bool PuedeResponder(Jugador jugador)
        {
            return estado == "Dibujando" &&
                jugador.EnPartida &&
                jugador.IdSesion != idDibujante;
        }

        private int RegistrarAcierto(Jugador jugador)
        {
            estado = "EntreRondas";

            int puntosGanados = 100 + (segundosRonda * 5);
            jugador.Puntos += puntosGanados;

            var dibujante = BuscarPorSesion(idDibujante);

            if (dibujante != null)
                dibujante.Puntos += 50;

            return puntosGanados;
        }

        private void PrepararNuevaPartida()
        {
            foreach (var jugador in Jugadores.Values)
            {
                if (jugador.Conectado)
                {
                    jugador.EnPartida = true;
                    jugador.Puntos = 0;
                }
            }

            rondaActual = 0;
            palabraActual = "";
            idDibujante = null;
            turnosPendientes.Clear();
            estado = "Lobby";
        }

        private async Task EnviarEstadoActual(Jugador jugador)
        {
            if (jugador.IdConexion == null)
                return;

            if (estado == "CuentaRegresiva")
            {
                await hub.Clients.Client(jugador.IdConexion).SendAsync("LobbyActualizado", segundosLobby, JugadoresEnPartidaDto());
            }
            else if (estado == "SeleccionPalabra")
            {
                await EnviarEstadoSeleccion(jugador);
            }
            else if (estado == "Dibujando")
            {
                await EnviarRondaAJugador(jugador);
            }
            else if (estado == "EntreRondas")
            {
                await hub.Clients.Client(jugador.IdConexion).SendAsync("EsperandoSiguienteRonda", "Preparando la siguiente ronda...");
            }
            else if (estado == "Finalizado")
            {
                await hub.Clients.Client(jugador.IdConexion).SendAsync("PartidaFinalizada", Resultados());
            }
            else
            {
                await hub.Clients.Client(jugador.IdConexion).SendAsync("EsperandoJugadores");
            }
        }

        private async Task EnviarEstadoSeleccion(Jugador jugador)
        {
            if (jugador.IdConexion == null)
                return;

            if (jugador.IdSesion == idDibujante)
                await hub.Clients.Client(jugador.IdConexion).SendAsync("PalabrasParaElegir", opcionesActuales, segundosSeleccion);
            else
                await hub.Clients.Client(jugador.IdConexion).SendAsync("EsperandoDibujante", NombreDibujante(), rondaActual, TotalRondas, segundosSeleccion);
        }

        private async Task IniciarCuentaRegresiva()
        {
            bool iniciar;

            lock (candado)
            {
                iniciar = estado == "Lobby";

                if (iniciar)
                {
                    estado = "CuentaRegresiva";
                    segundosLobby = SegundosEspera;
                    timerLobby?.Dispose();
                }
            }

            if (!iniciar)
                return;

            await hub.Clients.Clients(ConexionesEnPartida()).SendAsync("LobbyActualizado", segundosLobby, JugadoresEnPartidaDto());

            timerLobby = new Timer(async _ =>
            {
                await ActualizarLobby();
            }, null, 1000, 1000);
        }

        private async Task ActualizarLobby()
        {
            bool comenzar = false;
            bool cancelar = false;

            lock (candado)
            {
                if (estado != "CuentaRegresiva")
                    return;

                if (JugadoresEnPartida().Count < 2)
                {
                    estado = "Lobby";
                    cancelar = true;
                }
                else
                {
                    segundosLobby--;
                    comenzar = segundosLobby <= 0;
                }
            }

            if (cancelar)
            {
                DetenerTimerLobby();
                await hub.Clients.Clients(ConexionesEnPartida()).SendAsync("EsperandoJugadores");
                return;
            }

            await hub.Clients.Clients(ConexionesEnPartida()).SendAsync("LobbyActualizado", segundosLobby, JugadoresEnPartidaDto());

            if (comenzar)
            {
                DetenerTimerLobby();
                await IniciarSeleccionPalabra();
            }
        }

        private async Task IniciarSeleccionPalabra()
        {
            Jugador? dibujante;

            lock (candado)
            {
                if (JugadoresEnPartida().Count < 2)
                {
                    estado = "Lobby";
                    return;
                }

                rondaActual++;

                if (rondaActual > TotalRondas)
                {
                    estado = "Finalizado";
                    dibujante = null;
                }
                else
                {
                    dibujante = PrepararSeleccionPalabra();
                }
            }

            if (rondaActual > TotalRondas)
            {
                await FinalizarPartida();
                return;
            }

            await EnviarSeleccionPalabra(dibujante);
            IniciarTimerSeleccion();
        }

        private Jugador PrepararSeleccionPalabra()
        {
            estado = "SeleccionPalabra";
            segundosSeleccion = SegundosPalabra;
            opcionesActuales = palabras.OrderBy(_ => random.Next()).Take(3).ToArray();

            var dibujante = SiguienteDibujante();

            idDibujante = dibujante.IdSesion;
            palabraActual = "";

            return dibujante;
        }

        private async Task EnviarSeleccionPalabra(Jugador? dibujante)
        {
            await hub.Clients.Client(dibujante?.IdConexion ?? "").SendAsync("PalabrasParaElegir", opcionesActuales, segundosSeleccion);

            var otros = ConexionesEnPartida().Where(x => x != dibujante?.IdConexion).ToList();
            await hub.Clients.Clients(otros).SendAsync("EsperandoDibujante", dibujante?.Nombre, rondaActual, TotalRondas, segundosSeleccion);
        }

        private void IniciarTimerSeleccion()
        {
            timerSeleccion?.Dispose();
            timerSeleccion = new Timer(async _ =>
            {
                await ActualizarSeleccion();
            }, null, 1000, 1000);
        }

        private async Task ActualizarSeleccion()
        {
            bool iniciar = false;
            string palabra = "";

            lock (candado)
            {
                if (estado != "SeleccionPalabra")
                    return;

                segundosSeleccion--;
                iniciar = segundosSeleccion <= 0;

                if (iniciar)
                    palabra = opcionesActuales[random.Next(opcionesActuales.Length)];
            }

            await hub.Clients.Clients(ConexionesEnPartida()).SendAsync("TimerSeleccion", segundosSeleccion);

            if (iniciar)
                await IniciarRonda(palabra);
        }

        private async Task IniciarRonda(string palabra)
        {
            lock (candado)
            {
                if (estado != "SeleccionPalabra")
                    return;

                timerSeleccion?.Dispose();
                estado = "Dibujando";
                palabraActual = palabra;
                segundosRonda = SegundosDibujo;
            }

            foreach (var jugador in JugadoresEnPartida())
                await EnviarRondaAJugador(jugador);

            timerRonda = new Timer(async _ =>
            {
                await ActualizarRonda();
            }, null, 1000, 1000);
        }

        private async Task ActualizarRonda()
        {
            bool termino = false;

            lock (candado)
            {
                if (estado != "Dibujando")
                    return;

                segundosRonda--;
                termino = segundosRonda <= 0;

                if (termino)
                    estado = "EntreRondas";
            }

            await hub.Clients.Clients(ConexionesEnPartida()).SendAsync("TimerRonda", segundosRonda);

            if (termino)
            {
                DetenerTimerRonda();
                await hub.Clients.Clients(ConexionesEnPartida()).SendAsync("TiempoTerminado", palabraActual);
                await EnviarMensaje("Sistema", $"Nadie adivino. La palabra era {palabraActual}");
                await ProgramarSiguienteRonda();
            }
        }

        private async Task EnviarRondaAJugador(Jugador jugador)
        {
            if (jugador.IdConexion == null)
                return;

            bool esDibujante = jugador.IdSesion == idDibujante;

            await hub.Clients.Client(jugador.IdConexion).SendAsync("RondaIniciada",
                NombreDibujante(),
                esDibujante ? palabraActual : "",
                palabraActual.Length,
                rondaActual,
                TotalRondas,
                segundosRonda,
                esDibujante);
        }

        private async Task ProgramarSiguienteRonda()
        {
            lock (candado)
            {
                estado = "EntreRondas";
                ActivarJugadoresEnEspera();
                timerSiguienteRonda?.Dispose();
            }

            await EnviarPuntajes();

            timerSiguienteRonda = new Timer(async _ =>
            {
                timerSiguienteRonda?.Dispose();
                await IniciarSeleccionPalabra();
            }, null, 3500, Timeout.Infinite);
        }

        private async Task FinalizarPartida()
        {
            DetenerTimers();

            lock (candado)
            {
                estado = "Finalizado";
            }

            await hub.Clients.Clients(ConexionesEnPartida()).SendAsync("PartidaFinalizada", Resultados());
        }

        private async Task EnviarMensaje(string usuario, string texto)
        {
            await hub.Clients.Clients(ConexionesEnPartida()).SendAsync("MensajeRecibido", usuario, texto);
        }

        private async Task EnviarPuntajes()
        {
            await hub.Clients.Clients(ConexionesEnPartida()).SendAsync("PuntajesActualizados", JugadoresEnPartidaDto());
        }

        private Jugador? BuscarPorConexion(string idConexion)
        {
            return Jugadores.Values.FirstOrDefault(x => x.IdConexion == idConexion);
        }

        private Jugador? BuscarPorSesion(string? idSesion)
        {
            return Jugadores.Values.FirstOrDefault(x => x.IdSesion == idSesion);
        }

        private Jugador? BuscarDesconectadoPorNombre(string nombre)
        {
            return Jugadores.Values.FirstOrDefault(x => !x.Conectado &&
                x.EnPartida &&
                x.Nombre.Equals(nombre, StringComparison.OrdinalIgnoreCase));
        }

        private List<Jugador> JugadoresEnPartida()
        {
            return Jugadores.Values.Where(x => x.EnPartida && x.Conectado).ToList();
        }

        private List<string> ConexionesEnPartida()
        {
            return JugadoresEnPartida().Where(x => x.IdConexion != null).Select(x => x.IdConexion ?? "").ToList();
        }

        private void CambiarSesionJugador(Jugador jugador, string idSesion)
        {
            var sesionAnterior = jugador.IdSesion;

            if (Jugadores.TryRemove(sesionAnterior, out _))
            {
                jugador.IdSesion = idSesion;
                Jugadores[idSesion] = jugador;
            }

            if (idDibujante == sesionAnterior)
                idDibujante = idSesion;

            for (int i = 0; i < turnosPendientes.Count; i++)
            {
                if (turnosPendientes[i] == sesionAnterior)
                    turnosPendientes[i] = idSesion;
            }
        }

        private void ActivarJugadoresEnEspera()
        {
            foreach (var jugador in Jugadores.Values.Where(x => x.Conectado && !x.EnPartida))
            {
                jugador.EnPartida = true;
                jugador.Puntos = 0;
            }
        }

        private Jugador SiguienteDibujante()
        {
            var jugadores = JugadoresEnPartida();
            turnosPendientes = turnosPendientes
                .Where(id => jugadores.Any(j => j.IdSesion == id))
                .ToList();

            if (turnosPendientes.Count == 0)
                turnosPendientes = jugadores.Select(x => x.IdSesion).ToList();

            var id = turnosPendientes[0];
            turnosPendientes.RemoveAt(0);

            return jugadores.First(x => x.IdSesion == id);
        }

        private bool SalaLlena()
        {
            return Jugadores.Values.Count(x => x.Conectado) >= MaximoJugadores;
        }

        private object[] JugadoresEnPartidaDto()
        {
            return Jugadores.Values.Where(x => x.EnPartida && x.Conectado)
                .OrderByDescending(x => x.Puntos)
                .Select(x => new
                {
                    x.Nombre,
                    x.Puntos,
                    x.Conectado
                }).ToArray();
        }

        private object[] Resultados()
        {
            return Jugadores.Values.Where(x => x.EnPartida)
                .OrderByDescending(x => x.Puntos)
                .Select((x, i) => new
                {
                    Lugar = i + 1,
                    x.Nombre,
                    x.Puntos
                }).ToArray();
        }

        public string NombreDibujante()
        {
            return BuscarPorSesion(idDibujante)?.Nombre ?? "";
        }

        public string Normalizar(string texto)
        {
            var normalizado = texto.Trim().ToUpperInvariant().Normalize(NormalizationForm.FormD);
            var sb = new StringBuilder();

            foreach (var c in normalizado)
            {
                if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                    sb.Append(c);
            }

            return Regex.Replace(sb.ToString().Normalize(NormalizationForm.FormC), @"\s+", " ");
        }

        public void DetenerTimerLobby()
        {
            timerLobby?.Dispose();
            timerLobby = null;
        }

        public void DetenerTimerRonda()
        {
            timerRonda?.Dispose();
            timerRonda = null;
        }

        public void DetenerTimers()
        {
            timerLobby?.Dispose();
            timerSeleccion?.Dispose();
            timerRonda?.Dispose();
            timerSiguienteRonda?.Dispose();

            timerLobby = null;
            timerSeleccion = null;
            timerRonda = null;
            timerSiguienteRonda = null;
        }
    }
}
