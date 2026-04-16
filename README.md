# Monster Tracker 🥤
Tracker de Monsters da equipe de Software Embarcado.

## Estrutura
```
monster-tracker/
├── server.js       ← backend Node.js (API REST + serve o frontend)
├── package.json
├── data.json       ← criado automaticamente ao primeiro registro
└── public/
    └── index.html  ← frontend
```

## Como rodar no servidor

### 1. Instalar Node.js (se ainda não tiver)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Copiar os arquivos para o servidor
```bash
scp -r monster-tracker/ usuario@seu-servidor:/opt/monster-tracker
```

### 3. Instalar dependências e iniciar
```bash
cd /opt/monster-tracker
npm install
node server.js
```
O site estará disponível em `http://seu-servidor:3000`

---

### Rodar em background com PM2 (recomendado)
```bash
npm install -g pm2
pm2 start server.js --name monster-tracker
pm2 save
pm2 startup   # para iniciar automaticamente no boot
```

---

### Porta diferente
Defina a variável de ambiente antes de iniciar:
```bash
PORT=8080 node server.js
```

### Login administrativo
O acesso administrativo usa sessão por cookie e protege ações como remover histórico e consultar a lista administrativa de usuários.

Defina as credenciais antes de subir o servidor:
```bash
ADMIN_USER=admin ADMIN_PASSWORD=sua-senha-forte node server.js
```

Use a página administrativa em:
`http://seu-servidor:3000/admin`

Nessa página você pode:
- visualizar histórico completo
- apagar registros do histórico
- adicionar usuários
- remover usuários
- adicionar sabores
- remover sabores
- enviar PNG da lata para cada sabor

---

### Nginx como proxy reverso (opcional, para usar porta 80)
```nginx
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

### API endpoints
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/entries | Lista todos os registros |
| POST | /api/entries | Cria novo registro |
| DELETE | /api/entries/:id | Remove um registro |

### Backup dos dados
Os dados ficam em `data.json`. Faça backup desse arquivo periodicamente:
```bash
cp /opt/monster-tracker/data.json /backup/data-$(date +%F).json
```
