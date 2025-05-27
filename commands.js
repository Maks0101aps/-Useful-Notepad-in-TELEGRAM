const { Markup } = require('telegraf');
const db = require('./database');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function startCommand(ctx) {
  const userId = ctx.from.id;
  db.getUserData(userId);
  
  return ctx.reply(
    'Welcome to Useful Notepad! 📝\n\n' +
    'This bot will help you store important information, passwords and notes in a convenient format.\n\n' +
    'Available commands:\n' +
    'folders - manage folders\n' +
    'note - create a new note\n' +
    'notes - view notes in the current folder\n' +
    'search - search through notes\n' +
    'tags - view all tags\n' +
    'settings - configure encryption\n' +
    'help - show help'
  );
}


async function helpCommand(ctx) {
  return ctx.reply(
    'Command help:\n\n' +
    'start - start working with the bot\n' +
    'folders - manage folders\n' +
    'createfolder - create a new folder\n' +
    'note - create a new note\n' +
    'notes - view notes in the current folder\n' +
    'search - search through notes\n' +
    'tags - view all tags\n' +
    'settings - configure encryption\n' +
    'help - show this help'
  );
}


async function foldersCommand(ctx) {
  const userId = ctx.from.id;
  const folders = db.getFolders(userId);
  const userData = db.getUserData(userId);
  
  const buttons = folders.map(folder => {
    const isActive = userData.currentFolder === folder.id;
    const folderName = isActive ? `📂 ${folder.name} (active)` : `📁 ${folder.name}`;
    return [Markup.button.callback(folderName, `folder:${folder.id}`)];
  });
  
  buttons.push([Markup.button.callback('📝 Create new folder', 'create_folder')]);
  
  return ctx.reply(
    'Your folders:',
    Markup.inlineKeyboard(buttons)
  );
}


async function createFolderCommand(ctx) {
  if (!ctx.session) ctx.session = {};
  ctx.session.awaitingFolderName = true;
  return ctx.reply('Enter a name for the new folder:');
}


async function processNewFolder(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.awaitingFolderName) return false;
  
  const folderName = ctx.message.text.trim();
  
  if (folderName.length < 1 || folderName.length > 50) {
    await ctx.reply('Folder name must be between 1 and 50 characters. Try again:');
    return true;
  }
  
  const userId = ctx.from.id;
  const success = db.createFolder(userId, folderName);
  
  if (success) {
    await ctx.reply(`Folder "${folderName}" successfully created!`);
  } else {
    await ctx.reply(`A folder named "${folderName}" already exists. Please choose a different name:`);
    return true;
  }
  
  ctx.session.awaitingFolderName = false;
  return true;
}


async function createNoteCommand(ctx) {
  if (!ctx.session) ctx.session = {};
  ctx.session.creatingNote = true;
  ctx.session.noteStep = 'folder';
  ctx.session.noteTags = [];
  ctx.session.noteAttachments = [];
  ctx.session.noteEncrypt = false;
  
  const userId = ctx.from.id;
  const folders = db.getFolders(userId);
  
  const buttons = folders.map(folder => {
    return [Markup.button.callback(`📁 ${folder.name}`, `select_folder_for_note:${folder.id}`)];
  });
  
  return ctx.reply(
    'Select a folder for your new note:',
    Markup.inlineKeyboard(buttons)
  );
}


async function selectFolderForNote(ctx, folderId) {
  if (!ctx.session) ctx.session = {};
  ctx.session.creatingNote = true;
  ctx.session.noteStep = 'title';
  ctx.session.selectedFolderId = folderId;
  
  const userId = ctx.from.id;
  const userData = db.getUserData(userId);
  const folderName = userData.folders[folderId]?.name || 'Unknown';
  
  await ctx.answerCbQuery(`Folder "${folderName}" selected for note`);
  await ctx.reply(`Creating note in folder: "${folderName}"`);
  await ctx.reply('Enter a title for the new note:');
}


async function processNewNote(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.creatingNote) return false;
  
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();
  const userData = db.getUserData(userId);
  
  // Убедимся, что поле settings существует
  if (!userData.settings) {
    userData.settings = {
      encryptionEnabled: false,
      encryptionKey: ''
    };
    db.saveUserData(userId, userData);
  }
  
  if (ctx.session.noteStep === 'title') {
    if (text.length < 1 || text.length > 100) {
      await ctx.reply('Title must be between 1 and 100 characters. Try again:');
      return true;
    }
    
    ctx.session.noteTitle = text;
    ctx.session.noteStep = 'content';
    await ctx.reply('Now enter the content of the note:');
    return true;
  }
  
  if (ctx.session.noteStep === 'content') {
    if (text.length < 1) {
      await ctx.reply('Note content cannot be empty. Try again:');
      return true;
    }
    
    ctx.session.noteContent = text;
    ctx.session.noteStep = 'tags';
    
    await ctx.reply(
      'Do you want to add tags to this note? (Enter tags separated by commas or type "skip" to continue)',
      Markup.keyboard([['Skip']])
        .oneTime()
        .resize()
    );
    return true;
  }
  
  if (ctx.session.noteStep === 'tags') {
    if (text.toLowerCase() !== 'skip') {
      const tags = text.split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0)
        .map(tag => tag.startsWith('#') ? tag : `#${tag}`);
      
      ctx.session.noteTags = tags;
      await ctx.reply(`Added ${tags.length} tags: ${tags.join(', ')}`);
    }
    
    ctx.session.noteStep = 'encrypt';
    
    if (userData.settings.encryptionEnabled) {
      await ctx.reply(
        'Do you want to encrypt this note?',
        Markup.keyboard([['Yes', 'No']])
          .oneTime()
          .resize()
      );
    } else {
      ctx.session.noteEncrypt = false;
      ctx.session.noteStep = 'save';
      await finishNoteCreation(ctx);
    }
    
    return true;
  }
  
  if (ctx.session.noteStep === 'encrypt') {
    ctx.session.noteEncrypt = text.toLowerCase() === 'yes';
    ctx.session.noteStep = 'save';
    
    await finishNoteCreation(ctx);
    return true;
  }
  
  return false;
}

async function finishNoteCreation(ctx) {
  const userId = ctx.from.id;
  
  // Сохраняем текущую папку
  const userData = db.getUserData(userId);
  const currentFolder = userData.currentFolder;
  
  // Устанавливаем выбранную папку
  if (ctx.session.selectedFolderId) {
    db.setCurrentFolder(userId, ctx.session.selectedFolderId);
  }
  
  // Добавляем заметку
  const noteId = db.addNote(userId, ctx.session.noteTitle, ctx.session.noteContent, {
    tags: ctx.session.noteTags || [],
    attachments: ctx.session.noteAttachments || [],
    encrypt: ctx.session.noteEncrypt
  });
  
  // Восстанавливаем предыдущую текущую папку
  if (ctx.session.selectedFolderId) {
    db.setCurrentFolder(userId, currentFolder);
  }
  
  const folderName = userData.folders[ctx.session.selectedFolderId || currentFolder].name;
  
  let message = `Note "${ctx.session.noteTitle}" successfully created in folder "${folderName}"!`;
  
  if (ctx.session.noteTags && ctx.session.noteTags.length > 0) {
    message += `\nTags: ${ctx.session.noteTags.join(', ')}`;
  }
  
  if (ctx.session.noteEncrypt) {
    message += '\nThis note is encrypted.';
  }
  
  await ctx.reply(message, Markup.removeKeyboard());
  
  ctx.session.creatingNote = false;
  ctx.session.noteStep = null;
  ctx.session.noteTitle = null;
  ctx.session.noteContent = null;
  ctx.session.selectedFolderId = null;
  ctx.session.noteTags = null;
  ctx.session.noteAttachments = null;
  ctx.session.noteEncrypt = null;
}

async function notesCommand(ctx) {
  const userId = ctx.from.id;
  const notes = db.getNotes(userId);
  const userData = db.getUserData(userId);
  const currentFolder = userData.folders[userData.currentFolder];
  
  if (notes.length === 0) {
    return ctx.reply(`There are no notes in the "${currentFolder.name}" folder. Use note command to create a new note.`);
  }
  
  const buttons = notes.map(note => {
    const lockIcon = note.isEncrypted ? '🔒 ' : '';
    return [Markup.button.callback(`${lockIcon}📝 ${note.title}`, `note:${note.id}`)];
  });
  
  return ctx.reply(
    `Notes in folder "${currentFolder.name}":`,
    Markup.inlineKeyboard(buttons)
  );
}


async function searchCommand(ctx) {
  if (!ctx.session) ctx.session = {};
  ctx.session.searching = true;
  return ctx.reply('Enter search query (use #tag to search by tag):');
}


async function processSearch(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.searching) return false;
  
  const userId = ctx.from.id;
  const query = ctx.message.text.trim();
  
  if (query.length < 3 && !query.startsWith('#')) {
    await ctx.reply('Search query must contain at least 3 characters. Try again:');
    return true;
  }
  
  const results = db.searchNotes(userId, query);
  
  if (results.length === 0) {
    await ctx.reply(`No results found for "${query}".`);
  } else {
    const buttons = results.map(note => {
      const lockIcon = note.isEncrypted ? '🔒 ' : '';
      return [Markup.button.callback(`${lockIcon}📝 ${note.title} (${note.folderName})`, `note:${note.id}`)];
    });
    
    await ctx.reply(
      `Search results for "${query}":`,
      Markup.inlineKeyboard(buttons)
    );
  }
  
  ctx.session.searching = false;
  return true;
}


async function handleFolderSelect(ctx, folderId) {
  const userId = ctx.from.id;
  const success = db.setCurrentFolder(userId, folderId);
  
  if (success) {
    const userData = db.getUserData(userId);
    const folderName = userData.folders[folderId].name;
    await ctx.answerCbQuery(`Folder "${folderName}" selected`);
    await ctx.editMessageText(
      `Current folder: "${folderName}"`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Create note', 'create_note')],
        [Markup.button.callback('📋 Show notes', 'show_notes')],
        [Markup.button.callback('🗑️ Delete folder', `delete_folder:${folderId}`)],
        [Markup.button.callback('◀️ Back to folders', 'back_to_folders')]
      ])
    );
  } else {
    await ctx.answerCbQuery('Error selecting folder');
  }
}


async function handleNoteView(ctx, noteId) {
  const userId = ctx.from.id;
  const note = db.getNote(userId, noteId);
  
  if (!note) {
    await ctx.answerCbQuery('Note not found');
    return;
  }
  
  await ctx.answerCbQuery();
  
  let messageText = `📝 ${note.title}\n\n`;
  
  if (note.isEncrypted && !note.content) {
    messageText += '🔒 This note is encrypted. Set encryption key in settings to view it.';
  } else {
    messageText += note.content;
  }
  
  messageText += `\n\nFolder: ${note.folderName}`;
  
  if (note.tags && note.tags.length > 0) {
    messageText += `\nTags: ${note.tags.join(', ')}`;
  }
  
  messageText += `\nCreated: ${new Date(note.createdAt).toLocaleString()}`;
  messageText += `\nUpdated: ${new Date(note.updatedAt).toLocaleString()}`;
  
  const buttons = [
    [Markup.button.callback('✏️ Edit note', `edit_note:${noteId}`)],
    [Markup.button.callback('🗑️ Delete note', `delete_note:${noteId}`)],
    [Markup.button.callback('◀️ Back', 'back_to_notes')]
  ];
  
  await ctx.editMessageText(messageText, Markup.inlineKeyboard(buttons));
}


async function handleEditNote(ctx, noteId) {
  if (!ctx.session) ctx.session = {};
  
  const userId = ctx.from.id;
  const note = db.getNote(userId, noteId);
  
  if (!note) {
    await ctx.answerCbQuery('Note not found');
    return;
  }
  
  await ctx.answerCbQuery('Choose what to edit');
  
  const buttons = [
    [Markup.button.callback('✏️ Edit title', `edit_note_title:${noteId}`)],
    [Markup.button.callback('✏️ Edit content', `edit_note_content:${noteId}`)],
    [Markup.button.callback('🏷️ Edit tags', `edit_note_tags:${noteId}`)],
    note.isEncrypted ? 
      [Markup.button.callback('🔓 Decrypt note', `toggle_encryption:${noteId}:0`)] : 
      [Markup.button.callback('🔒 Encrypt note', `toggle_encryption:${noteId}:1`)],
    [Markup.button.callback('◀️ Back to note', `note:${noteId}`)]
  ];
  
  await ctx.editMessageText(
    `Editing note: "${note.title}"`,
    Markup.inlineKeyboard(buttons)
  );
}


async function handleEditNoteTitle(ctx, noteId) {
  if (!ctx.session) ctx.session = {};
  
  ctx.session.editingNote = true;
  ctx.session.editingNoteId = noteId;
  ctx.session.editingNoteField = 'title';
  
  await ctx.answerCbQuery();
  await ctx.reply('Enter new title for the note:');
}


async function handleEditNoteContent(ctx, noteId) {
  if (!ctx.session) ctx.session = {};
  
  ctx.session.editingNote = true;
  ctx.session.editingNoteId = noteId;
  ctx.session.editingNoteField = 'content';
  
  await ctx.answerCbQuery();
  await ctx.reply('Enter new content for the note:');
}


async function handleEditNoteTags(ctx, noteId) {
  if (!ctx.session) ctx.session = {};
  
  ctx.session.editingNote = true;
  ctx.session.editingNoteId = noteId;
  ctx.session.editingNoteField = 'tags';
  
  const userId = ctx.from.id;
  const note = db.getNote(userId, noteId);
  
  await ctx.answerCbQuery();
  await ctx.reply(
    `Current tags: ${note.tags.length > 0 ? note.tags.join(', ') : 'None'}\n\nEnter new tags separated by commas:`,
    Markup.keyboard([['Cancel']])
      .oneTime()
      .resize()
  );
}


async function handleToggleEncryption(ctx, noteId, encrypt) {
  const userId = ctx.from.id;
  const userData = db.getUserData(userId);
  
  // Убедимся, что поле settings существует
  if (!userData.settings) {
    userData.settings = {
      encryptionEnabled: false,
      encryptionKey: ''
    };
    db.saveUserData(userId, userData);
  }
  
  if (encrypt === '1' && !userData.settings.encryptionKey) {
    await ctx.answerCbQuery('Set encryption key in settings first');
    return;
  }
  
  const success = db.updateNote(userId, noteId, { encrypt: encrypt === '1' });
  
  if (success) {
    await ctx.answerCbQuery(encrypt === '1' ? 'Note encrypted' : 'Note decrypted');
    await handleNoteView(ctx, noteId);
  } else {
    await ctx.answerCbQuery('Error updating note');
  }
}


async function processEditNote(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.editingNote) return false;
  
  const userId = ctx.from.id;
  const noteId = ctx.session.editingNoteId;
  const field = ctx.session.editingNoteField;
  const text = ctx.message.text.trim();
  
  if (text.toLowerCase() === 'cancel') {
    ctx.session.editingNote = false;
    ctx.session.editingNoteId = null;
    ctx.session.editingNoteField = null;
    
    await ctx.reply('Editing cancelled', Markup.removeKeyboard());
    return true;
  }
  
  let updates = {};
  
  if (field === 'title') {
    if (text.length < 1 || text.length > 100) {
      await ctx.reply('Title must be between 1 and 100 characters. Try again:');
      return true;
    }
    
    updates.title = text;
  } else if (field === 'content') {
    if (text.length < 1) {
      await ctx.reply('Content cannot be empty. Try again:');
      return true;
    }
    
    updates.content = text;
  } else if (field === 'tags') {
    const tags = text.split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`);
    
    updates.tags = tags;
  }
  
  const success = db.updateNote(userId, noteId, updates);
  
  if (success) {
    await ctx.reply(`Note ${field} updated successfully`, Markup.removeKeyboard());
  } else {
    await ctx.reply(`Error updating note ${field}`, Markup.removeKeyboard());
  }
  
  ctx.session.editingNote = false;
  ctx.session.editingNoteId = null;
  ctx.session.editingNoteField = null;
  
  return true;
}


async function handleNoteDelete(ctx, noteId) {
  const userId = ctx.from.id;
  const success = db.deleteNote(userId, noteId);
  
  if (success) {
    await ctx.answerCbQuery('Note deleted');
    await ctx.editMessageText(
      'Note successfully deleted.',
      Markup.inlineKeyboard([
        [Markup.button.callback('◀️ Back to notes', 'back_to_notes')]
      ])
    );
  } else {
    await ctx.answerCbQuery('Error deleting note');
  }
}


async function handleFolderDelete(ctx, folderId) {
  const userId = ctx.from.id;
  
  if (folderId === 'root') {
    await ctx.answerCbQuery('Cannot delete root folder');
    return;
  }
  
  const userData = db.getUserData(userId);
  const folderName = userData.folders[folderId]?.name || '';
  
  const success = db.deleteFolder(userId, folderId);
  
  if (success) {
    await ctx.answerCbQuery(`Folder "${folderName}" deleted`);
    await foldersCommand(ctx);
  } else {
    await ctx.answerCbQuery('Error deleting folder');
  }
}

async function tagsCommand(ctx) {
  const userId = ctx.from.id;
  const tags = db.getTags(userId);
  
  if (tags.length === 0) {
    return ctx.reply('You have no tags yet. Add tags when creating or editing notes.');
  }
  
  const buttons = tags.map(tag => {
    return [Markup.button.callback(`${tag.name} (${tag.count})`, `search:#${tag.name.replace('#', '')}`)];
  });
  
  return ctx.reply(
    'Your tags:',
    Markup.inlineKeyboard(buttons)
  );
}

async function settingsCommand(ctx) {
  const userId = ctx.from.id;
  const userData = db.getUserData(userId);
  
  // Убедимся, что поле settings существует
  if (!userData.settings) {
    userData.settings = {
      encryptionEnabled: false,
      encryptionKey: ''
    };
    db.saveUserData(userId, userData);
  }
  
  const encryptionStatus = userData.settings.encryptionEnabled ? 
    'Encryption is enabled' : 
    'Encryption is disabled';
  
  const buttons = [
    [Markup.button.callback('🔑 Set encryption key', 'set_encryption_key')],
    userData.settings.encryptionEnabled ?
      [Markup.button.callback('🔓 Disable encryption', 'toggle_encryption:0')] :
      [Markup.button.callback('🔒 Enable encryption', 'toggle_encryption:1')],
    [Markup.button.callback('◀️ Back to main menu', 'back_to_main')]
  ];
  
  return ctx.reply(
    `Settings\n\n${encryptionStatus}`,
    Markup.inlineKeyboard(buttons)
  );
}

async function handleSetEncryptionKey(ctx) {
  if (!ctx.session) ctx.session = {};
  
  ctx.session.settingEncryptionKey = true;
  
  await ctx.answerCbQuery();
  await ctx.reply(
    'Enter your encryption key. This will be used to encrypt and decrypt your notes.\n\n' +
    '⚠️ WARNING: If you forget this key, you will not be able to recover encrypted notes!',
    Markup.keyboard([['Cancel']])
      .oneTime()
      .resize()
  );
}

async function handleToggleGlobalEncryption(ctx, enabled) {
  const userId = ctx.from.id;
  const userData = db.getUserData(userId);
  
  // Убедимся, что поле settings существует
  if (!userData.settings) {
    userData.settings = {
      encryptionEnabled: false,
      encryptionKey: ''
    };
    db.saveUserData(userId, userData);
  }
  
  if (enabled === '1' && !userData.settings.encryptionKey) {
    await ctx.answerCbQuery('Set encryption key first');
    return;
  }
  
  const success = db.toggleEncryption(userId, enabled === '1');
  
  if (success) {
    await ctx.answerCbQuery(enabled === '1' ? 'Encryption enabled' : 'Encryption disabled');
    await settingsCommand(ctx);
  } else {
    await ctx.answerCbQuery('Error toggling encryption');
  }
}

async function processSetEncryptionKey(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.settingEncryptionKey) return false;
  
  const userId = ctx.from.id;
  const key = ctx.message.text.trim();
  
  if (key.toLowerCase() === 'cancel') {
    ctx.session.settingEncryptionKey = false;
    await ctx.reply('Cancelled setting encryption key', Markup.removeKeyboard());
    return true;
  }
  
  if (key.length < 6) {
    await ctx.reply('Encryption key must be at least 6 characters long. Try again:');
    return true;
  }
  
  const success = db.setEncryptionKey(userId, key);
  
  if (success) {
    await ctx.reply('Encryption key set successfully. You can now encrypt notes.', Markup.removeKeyboard());
  } else {
    await ctx.reply('Error setting encryption key', Markup.removeKeyboard());
  }
  
  ctx.session.settingEncryptionKey = false;
  return true;
}

async function processFileUpload(ctx) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.creatingNote && !ctx.session.editingNote) return false;
  
  // Проверяем, есть ли файл в сообщении
  if (!ctx.message.document && !ctx.message.photo && !ctx.message.voice) {
    return false;
  }
  
  const userId = ctx.from.id;
  let fileId, fileName, fileType;
  
  if (ctx.message.document) {
    fileId = ctx.message.document.file_id;
    fileName = ctx.message.document.file_name || 'document';
    fileType = ctx.message.document.mime_type || 'application/octet-stream';
  } else if (ctx.message.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Берем самое большое фото
    fileId = photo.file_id;
    fileName = 'photo.jpg';
    fileType = 'image/jpeg';
  } else if (ctx.message.voice) {
    fileId = ctx.message.voice.file_id;
    fileName = 'voice.ogg';
    fileType = 'audio/ogg';
  }
  
  try {
    // Получаем информацию о файле
    const fileInfo = await ctx.telegram.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.telegram.token}/${fileInfo.file_path}`;
    
    // Скачиваем файл
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const fileData = Buffer.from(response.data);
    
    // Сохраняем вложение
    const attachment = db.saveAttachment(userId, fileData, fileName, fileType);
    
    if (ctx.session.creatingNote) {
      if (!ctx.session.noteAttachments) ctx.session.noteAttachments = [];
      ctx.session.noteAttachments.push(attachment);
      await ctx.reply(`Attachment "${fileName}" added to new note`);
    } else if (ctx.session.editingNote) {
      const noteId = ctx.session.editingNoteId;
      const success = db.updateNote(userId, noteId, {
        attachments: [attachment]
      });
      
      if (success) {
        await ctx.reply(`Attachment "${fileName}" added to note`);
      } else {
        await ctx.reply('Error adding attachment to note');
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error processing file:', error);
    await ctx.reply('Error processing file attachment');
    return true;
  }
}

module.exports = {
  startCommand,
  helpCommand,
  foldersCommand,
  createFolderCommand,
  processNewFolder,
  createNoteCommand,
  processNewNote,
  notesCommand,
  searchCommand,
  processSearch,
  handleFolderSelect,
  handleNoteView,
  handleNoteDelete,
  handleFolderDelete,
  selectFolderForNote,
  handleEditNote,
  handleEditNoteTitle,
  handleEditNoteContent,
  handleEditNoteTags,
  handleToggleEncryption,
  processEditNote,
  tagsCommand,
  settingsCommand,
  handleSetEncryptionKey,
  handleToggleGlobalEncryption,
  processSetEncryptionKey,
  processFileUpload
}; 