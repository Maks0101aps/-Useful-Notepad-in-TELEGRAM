const { Telegraf, session, Markup } = require('telegraf');
const config = require('./config');
const commands = require('./commands');

if (!config.botToken) {
  console.error('Error: BOT_TOKEN not specified in .env file');
  process.exit(1);
}

const bot = new Telegraf(config.botToken);

bot.use(session({
  defaultSession: () => ({
    awaitingFolderName: false,
    creatingNote: false,
    noteStep: null,
    noteTitle: null,
    noteContent: null,
    selectedFolderId: null,
    noteTags: null,
    noteAttachments: null,
    noteEncrypt: null,
    searching: false,
    editingNote: false,
    editingNoteId: null,
    editingNoteField: null,
    settingEncryptionKey: false
  })
}));

bot.command('start', async (ctx) => {
  await commands.startCommand(ctx);
  
  return ctx.reply('Choose an action:', Markup.keyboard([
    ['📁 Folders', '📝 New Note'],
    ['🔍 Search', '🏷️ Tags'],
    ['⚙️ Settings', '❓ Help']
  ]).resize());
});

bot.command('help', commands.helpCommand);
bot.command('folders', commands.foldersCommand);
bot.command('createfolder', commands.createFolderCommand);
bot.command('note', commands.createNoteCommand);
bot.command('notes', commands.notesCommand);
bot.command('search', commands.searchCommand);
bot.command('tags', commands.tagsCommand);
bot.command('settings', commands.settingsCommand);

// Обработка кнопок клавиатуры
bot.hears('📁 Folders', commands.foldersCommand);
bot.hears('📝 New Note', commands.createNoteCommand);
bot.hears('🔍 Search', commands.searchCommand);
bot.hears('🏷️ Tags', commands.tagsCommand);
bot.hears('⚙️ Settings', commands.settingsCommand);
bot.hears('❓ Help', commands.helpCommand);
bot.hears('Yes', (ctx) => ctx.message.text);
bot.hears('No', (ctx) => ctx.message.text);
bot.hears('Skip', (ctx) => ctx.message.text);
bot.hears('Cancel', (ctx) => ctx.message.text);

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  if (await commands.processNewFolder(ctx)) return;
  
  if (await commands.processNewNote(ctx)) return;
  
  if (await commands.processSearch(ctx)) return;
  
  if (await commands.processEditNote(ctx)) return;
  
  if (await commands.processSetEncryptionKey(ctx)) return;
  
  await commands.helpCommand(ctx);
});

// Обработка загрузки файлов
bot.on('document', commands.processFileUpload);
bot.on('photo', commands.processFileUpload);
bot.on('voice', commands.processFileUpload);

// Обработчики callback-запросов
bot.action('create_folder', commands.createFolderCommand);
bot.action('create_note', commands.createNoteCommand);
bot.action('show_notes', commands.notesCommand);
bot.action('back_to_folders', commands.foldersCommand);
bot.action('back_to_notes', commands.notesCommand);
bot.action('back_to_main', (ctx) => ctx.reply('Choose an action:', Markup.keyboard([
  ['📁 Folders', '📝 New Note'],
  ['🔍 Search', '🏷️ Tags'],
  ['⚙️ Settings', '❓ Help']
]).resize()));

// Настройки шифрования
bot.action('set_encryption_key', commands.handleSetEncryptionKey);
bot.action(/^toggle_encryption:(\d)$/, (ctx) => {
  const enabled = ctx.match[1];
  return commands.handleToggleGlobalEncryption(ctx, enabled);
});

// Обработчик выбора папки для заметки
bot.action(/^select_folder_for_note:(.+)$/, (ctx) => {
  const folderId = ctx.match[1];
  return commands.selectFolderForNote(ctx, folderId);
});

// Обработчик выбора папки
bot.action(/^folder:(.+)$/, (ctx) => {
  const folderId = ctx.match[1];
  return commands.handleFolderSelect(ctx, folderId);
});

// Обработчик просмотра заметки
bot.action(/^note:(.+)$/, (ctx) => {
  const noteId = ctx.match[1];
  return commands.handleNoteView(ctx, noteId);
});

// Обработчики редактирования заметки
bot.action(/^edit_note:(.+)$/, (ctx) => {
  const noteId = ctx.match[1];
  return commands.handleEditNote(ctx, noteId);
});

bot.action(/^edit_note_title:(.+)$/, (ctx) => {
  const noteId = ctx.match[1];
  return commands.handleEditNoteTitle(ctx, noteId);
});

bot.action(/^edit_note_content:(.+)$/, (ctx) => {
  const noteId = ctx.match[1];
  return commands.handleEditNoteContent(ctx, noteId);
});

bot.action(/^edit_note_tags:(.+)$/, (ctx) => {
  const noteId = ctx.match[1];
  return commands.handleEditNoteTags(ctx, noteId);
});

bot.action(/^toggle_encryption:(.+):(\d)$/, (ctx) => {
  const noteId = ctx.match[1];
  const encrypt = ctx.match[2];
  return commands.handleToggleEncryption(ctx, noteId, encrypt);
});

// Обработчик поиска по тегу
bot.action(/^search:(.+)$/, (ctx) => {
  const query = ctx.match[1];
  ctx.session.searching = true;
  return commands.processSearch({ ...ctx, message: { text: query } });
});

// Обработчик удаления заметки
bot.action(/^delete_note:(.+)$/, (ctx) => {
  const noteId = ctx.match[1];
  return commands.handleNoteDelete(ctx, noteId);
});

// Обработчик удаления папки
bot.action(/^delete_folder:(.+)$/, (ctx) => {
  const folderId = ctx.match[1];
  return commands.handleFolderDelete(ctx, folderId);
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
});

bot.launch()
  .then(() => {
    console.log('Bot successfully launched!');
    console.log('Bot username: @' + bot.botInfo?.username);
  })
  .catch((err) => {
    console.error('Error launching bot:', err);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 