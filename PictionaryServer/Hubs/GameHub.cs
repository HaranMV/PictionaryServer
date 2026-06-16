using Microsoft.AspNetCore.SignalR;
using PictionaryServer.Services;

namespace PictionaryServer.Hubs
{
    public class GameHub : Hub
    {
        private readonly PictionaryService service;

        public GameHub(PictionaryService service)
        {
            this.service = service;
        }

        public async Task Conectar(string idSesion, string nombre)
        {
            await service.Conectar(Context.ConnectionId, idSesion, nombre);
        }

        public async Task<bool> SeleccionarPalabra(string palabra)
        {
            return await service.SeleccionarPalabra(Context.ConnectionId, palabra);
        }

        public async Task ReenviarEstado()
        {
            await service.ReenviarEstado(Context.ConnectionId);
        }

        public async Task EnviarTrazo(double x1, double y1, double x2, double y2, string color, int grosor)
        {
            await service.EnviarTrazo(Context.ConnectionId, x1, y1, x2, y2, color, grosor);
        }

        public async Task EnviarRespuesta(string texto)
        {
            await service.EnviarRespuesta(Context.ConnectionId, texto);
        }

        public async Task ReiniciarJuego()
        {
            await service.ReiniciarJuego();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            await service.Desconectar(Context.ConnectionId);
            await base.OnDisconnectedAsync(exception);
        }
    }
}
