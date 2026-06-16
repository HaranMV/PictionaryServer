using PictionaryServer.Hubs;
using PictionaryServer.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddSingleton<PictionaryService>();
var app = builder.Build();

app.MapHub<GameHub>("/pictioHub");
app.UseFileServer();

app.Run();
