const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // Permite envio de fotos até 10MB via Socket.io
});

const DB_PATH = path.join(__dirname, 'db.json');

// Aumenta limite JSON para aceitar fotos em Base64 no cadastro
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Funções auxiliares para ler e salvar no db.json (estilo seu projeto CRUD)
function lerDB() {
  if (!fs.existsSync(DB_PATH)) {
    const inicial = {
      usuarios: [],
      mensagens: {
        'Geral XYZ': [],
        'Café & Fofocas': [],
        'Suporte TI': [],
        'Eu Odeio Acordar Cedo': []
      }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(inicial, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function salvarDB(dados) {
  fs.writeFileSync(DB_PATH, JSON.stringify(dados, null, 2));
}

// ================= ROTAS DE CADASTRO, LOGIN E ADMIN =================

// 1. Cadastrar novo usuário
app.post('/api/cadastro', (req, res) => {
  const { nome, username, senha, humor, fotoPerfil, fotoFundo } = req.body;

  if (!nome || !username || !senha) {
    return res.status(400).json({ erro: 'Preencha nome, usuário e senha!' });
  }

  const db = lerDB();
  const userClean = username.trim().toLowerCase();

  if (db.usuarios.some((u) => u.username.toLowerCase() === userClean)) {
    return res.status(400).json({ erro: 'Este nome de usuário já existe!' });
  }

  const novoUsuario = {
    id: Date.now(),
    nome: nome.trim(),
    username: username.trim(),
    senha: senha.trim(),
    cargo: db.usuarios.length === 0 ? 'admin' : 'usuario', // Primeiro cadastrado ou padrão
    humor: humor || '😊 Feliz',
    fotoPerfil: fotoPerfil || '',
    fotoFundo: fotoFundo || ''
  };

  db.usuarios.push(novoUsuario);
  salvarDB(db);

  res.status(201).json({ mensagem: 'Cadastro realizado com sucesso!', usuario: novoUsuario });
});

// 2. Login
app.post('/api/login', (req, res) => {
  const { username, senha } = req.body;
  const db = lerDB();

  const usuario = db.usuarios.find(
    (u) => u.username.toLowerCase() === username.trim().toLowerCase() && u.senha === senha
  );

  if (!usuario) {
    return res.status(401).json({ erro: 'Usuário ou senha inválidos!' });
  }

  // Retorna dados sem a senha
  const { senha: _, ...dadosSeguros } = usuario;
  res.json({ usuario: dadosSeguros });
});


// 2.5 Editar perfil completo (Nome, Username, Humor, Senha, Cargo, Foto de Perfil e Fundo)
app.put('/api/perfil/:id', (req, res) => {
  const id = Number(req.params.id);
  const { nome, username, humor, senha, cargo, fotoPerfil, fotoFundo } = req.body;
  const db = lerDB();

  const user = db.usuarios.find((u) => u.id === id);
  if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  // Verifica se o novo username já pertence a outra pessoa
  if (username && username.trim() !== '') {
    const novoUserClean = username.trim().toLowerCase();
    const duplicado = db.usuarios.some(
      (u) => u.id !== id && u.username.toLowerCase() === novoUserClean
    );
    if (duplicado) {
      return res.status(400).json({ erro: 'Este nome de usuário já está em uso!' });
    }
    user.username = username.trim();
  }

  if (nome && nome.trim() !== '') user.nome = nome.trim();
  if (humor) user.humor = humor;
  if (cargo && (cargo === 'admin' || cargo === 'usuario')) user.cargo = cargo;
  if (senha && senha.trim() !== '') user.senha = senha.trim();
  if (fotoPerfil !== undefined) user.fotoPerfil = fotoPerfil;
  if (fotoFundo !== undefined) user.fotoFundo = fotoFundo;

  salvarDB(db);

  // Atualiza em tempo real caso o usuário esteja online no chat
  Object.values(usuariosOnline).forEach((online) => {
    if (online.id === user.id || online.username === user.username) {
      online.username = user.username;
      online.nome = user.nome;
      online.humor = user.humor;
      online.cargo = user.cargo;
      online.fotoPerfil = user.fotoPerfil;
      atualizarUsuariosSala(online.sala);
    }
  });

  const { senha: _, ...dadosSeguros } = user;
  res.json({ mensagem: 'Perfil atualizado com sucesso!', usuario: dadosSeguros });
});
// 3. Rotas da Sessão Admin
app.get('/api/admin/dados', (req, res) => {
  const db = lerDB();
  const usuariosSemSenha = db.usuarios.map(({ senha, ...u }) => u);
  res.json({ usuarios: usuariosSemSenha, mensagens: db.mensagens });
});

app.put('/api/admin/usuario/:id/cargo', (req, res) => {
  const id = Number(req.params.id);
  const { cargo } = req.body;
  const db = lerDB();

  const user = db.usuarios.find((u) => u.id === id);
  if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  user.cargo = cargo;
  salvarDB(db);
  res.json({ mensagem: 'Cargo atualizado!' });
});

app.delete('/api/admin/usuario/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = lerDB();

  db.usuarios = db.usuarios.filter((u) => u.id !== id);
  salvarDB(db);
  res.json({ mensagem: 'Usuário removido!' });
});

app.delete('/api/admin/mensagens/:sala', (req, res) => {
  const sala = req.params.sala;
  const db = lerDB();
  if (db.mensagens[sala]) {
    db.mensagens[sala] = [];
    salvarDB(db);
    io.to(sala).emit('historico_mensagens', []);
  }
  res.json({ mensagem: `Scraps da comunidade ${sala} foram limpos!` });
});

// ================= SOCKET.IO (TEMPO REAL) =================

const usuariosOnline = {};

io.on('connection', (socket) => {
  socket.on('entrar_chat', ({ username, sala }) => {
    const db = lerDB();
    const userDB = db.usuarios.find((u) => u.username === username);

    if (!userDB) {
      socket.emit('erro_chat', 'Usuário não autenticado.');
      return;
    }

    const salaEscolhida = db.mensagens[sala] ? sala : 'Geral XYZ';

    usuariosOnline[socket.id] = {
      socketId: socket.id,
      username: userDB.username,
      nome: userDB.nome,
      cargo: userDB.cargo,
      humor: userDB.humor,
      fotoPerfil: userDB.fotoPerfil,
      sala: salaEscolhida
    };

    socket.join(salaEscolhida);
    socket.emit('historico_mensagens', db.mensagens[salaEscolhida]);

    io.to(salaEscolhida).emit('nova_mensagem', {
      tipo: 'sistema',
      texto: `✨ ${userDB.nome} (@${userDB.username}) entrou na comunidade "${salaEscolhida}".`,
      hora: obterHoraAtual()
    });

    atualizarUsuariosSala(salaEscolhida);
  });

  // Enviar texto, foto ou figurinha
  socket.on('enviar_mensagem', ({ texto, imagem, tipoConteudo }) => {
    const user = usuariosOnline[socket.id];
    if (!user) return;

    if ((!texto || texto.trim() === '') && !imagem) return;

    const db = lerDB();
    const mensagem = {
      id: Date.now(),
      tipo: 'usuario',
      tipoConteudo: tipoConteudo || 'texto', // 'texto', 'foto' ou 'figurinha'
      autor: user.nome,
      username: user.username,
      cargo: user.cargo,
      humor: user.humor,
      fotoPerfil: user.fotoPerfil,
      texto: texto ? texto.trim() : '',
      imagem: imagem || '',
      hora: obterHoraAtual()
    };

    if (!db.mensagens[user.sala]) db.mensagens[user.sala] = [];
    db.mensagens[user.sala].push(mensagem);

    // Mantém últimas 60 mensagens salvas por comunidade
    if (db.mensagens[user.sala].length > 60) {
      db.mensagens[user.sala].shift();
    }
    salvarDB(db);

    io.to(user.sala).emit('nova_mensagem', mensagem);
  });

  socket.on('trocar_sala', (novaSala) => {
    const user = usuariosOnline[socket.id];
    const db = lerDB();
    if (!user || !db.mensagens[novaSala] || user.sala === novaSala) return;

    const salaAntiga = user.sala;
    socket.leave(salaAntiga);
    io.to(salaAntiga).emit('nova_mensagem', {
      tipo: 'sistema',
      texto: `🚪 ${user.nome} saiu da comunidade.`,
      hora: obterHoraAtual()
    });
    atualizarUsuariosSala(salaAntiga);

    user.sala = novaSala;
    socket.join(novaSala);
    socket.emit('historico_mensagens', db.mensagens[novaSala]);
    io.to(novaSala).emit('nova_mensagem', {
      tipo: 'sistema',
      texto: `✨ ${user.nome} entrou na comunidade "${novaSala}".`,
      hora: obterHoraAtual()
    });
    atualizarUsuariosSala(novaSala);
  });

  socket.on('disconnect', () => {
    const user = usuariosOnline[socket.id];
    if (user) {
      const { nome, sala } = user;
      delete usuariosOnline[socket.id];
      io.to(sala).emit('nova_mensagem', {
        tipo: 'sistema',
        texto: `👋 ${nome} saiu do Orkut XYZ.`,
        hora: obterHoraAtual()
      });
      atualizarUsuariosSala(sala);
    }
  });
});

function atualizarUsuariosSala(sala) {
  const membros = Object.values(usuariosOnline).filter((u) => u.sala === sala);
  io.to(sala).emit('lista_usuarios', membros);
}

function obterHoraAtual() {
  return new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo'
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Orkut XYZ rodando em http://localhost:${PORT}`);
});