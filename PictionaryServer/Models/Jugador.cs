namespace PictionaryServer.Models
{
    public class Jugador
    {
        public string IdSesion { get; set; } = "";
        public string? IdConexion { get; set; }
        public string Nombre { get; set; } = "";
        public int Puntos { get; set; }
        public bool Conectado { get; set; } = true;
        public bool EnPartida { get; set; }
    }
}
