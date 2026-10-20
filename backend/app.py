"""
Compatibilidade: `uvicorn app:app` (comando antigo) continua funcionando.
O código do servidor fica no pacote `ritmo_server/`.
"""

from ritmo_server.main import app, run

__all__ = ["app"]

if __name__ == "__main__":
    run()
