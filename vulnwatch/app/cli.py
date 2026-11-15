"""Administration en ligne de commande (récupération d'accès).

    sudo cert-ansie-admin list
    sudo cert-ansie-admin reset-password <identifiant>
    sudo cert-ansie-admin create-admin <identifiant>
    sudo cert-ansie-admin unlock <identifiant>
"""
import sys

from .diag import load_env  # noqa: F401  (charge /etc/vulnwatch/vulnwatch.env)
from . import db, users  # noqa: E402


def main(argv: list[str]) -> int:
    db.init_db()
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    cmd, args = argv[0], argv[1:]
    if cmd == "list":
        rows = db.connect().execute("SELECT * FROM users ORDER BY id").fetchall()
        print(f"{'ID':>3}  {'Identifiant':20} {'Rôle':24} {'Actif':6} Dernière connexion")
        for r in rows:
            print(f"{r['id']:>3}  {r['username']:20} {users.ROLES[r['role']]['label']:24} "
                  f"{'oui' if r['active'] else 'non':6} {r['last_login'] or '-'}")
        return 0
    if not args:
        print("Identifiant manquant.\n" + __doc__)
        return 1
    name = args[0]
    u = users.by_username(name)
    if cmd == "reset-password":
        if not u:
            print(f"Compte '{name}' introuvable.")
            return 1
        pw = users.generate_password()
        users.set_password(u["id"], pw, must_change=True)
        with db.tx() as c:
            c.execute("UPDATE users SET active=1 WHERE id=?", (u["id"],))
        users.audit("console", "user.reset_password", u["username"], "via cert-ansie-admin")
        print(f"Nouveau mot de passe temporaire pour '{u['username']}' : {pw}\n(à changer à la première connexion)")
        return 0
    if cmd == "unlock":
        if not u:
            print(f"Compte '{name}' introuvable.")
            return 1
        with db.tx() as c:
            c.execute("UPDATE users SET locked_until=NULL, failed_count=0, active=1 WHERE id=?", (u["id"],))
        users.audit("console", "user.unlock", u["username"], "via cert-ansie-admin")
        print(f"Compte '{u['username']}' déverrouillé et activé.")
        return 0
    if cmd == "create-admin":
        if u:
            print(f"Le compte '{name}' existe déjà (utilisez reset-password).")
            return 1
        pw = users.generate_password()
        users.create(name, pw, "admin", name, must_change=True, created_by="console")
        users.audit("console", "user.create", name, "administrateur via cert-ansie-admin")
        print(f"Administrateur '{name}' créé. Mot de passe temporaire : {pw}")
        return 0
    print(f"Commande inconnue : {cmd}\n" + __doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
