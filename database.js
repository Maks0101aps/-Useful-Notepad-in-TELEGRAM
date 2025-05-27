const fs = require('fs');
const path = require('path');
const config = require('./config');
const crypto = require('crypto');

if (!fs.existsSync(config.dataFolder)) {
  fs.mkdirSync(config.dataFolder, { recursive: true });
}

function getUserData(userId) {
  const userFolderPath = path.join(config.dataFolder, userId.toString());
  const userDataPath = path.join(userFolderPath, 'data.json');
  
  if (!fs.existsSync(userFolderPath)) {
    fs.mkdirSync(userFolderPath, { recursive: true });
  }
  
  if (!fs.existsSync(userDataPath)) {
    const initialData = {
      folders: {
        root: {
          name: 'Root folder',
          notes: {}
        }
      },
      currentFolder: 'root',
      tags: {},
      settings: {
        encryptionEnabled: false,
        encryptionKey: ''
      }
    };
    fs.writeFileSync(userDataPath, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  
  const userData = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
  
  // Проверка на наличие всех необходимых полей (для обратной совместимости)
  if (!userData.settings) {
    userData.settings = {
      encryptionEnabled: false,
      encryptionKey: ''
    };
    fs.writeFileSync(userDataPath, JSON.stringify(userData, null, 2));
  }
  
  return userData;
}

function saveUserData(userId, data) {
  const userFolderPath = path.join(config.dataFolder, userId.toString());
  const userDataPath = path.join(userFolderPath, 'data.json');
  
  fs.writeFileSync(userDataPath, JSON.stringify(data, null, 2));
}

function createFolder(userId, folderName) {
  const userData = getUserData(userId);
  const folderId = `folder_${Date.now()}`;
  
  const folderExists = Object.values(userData.folders).some(folder => 
    folder.name.toLowerCase() === folderName.toLowerCase()
  );
  
  if (folderExists) {
    return false;
  }
  
  userData.folders[folderId] = {
    name: folderName,
    notes: {}
  };
  
  saveUserData(userId, userData);
  return true;
}

function encryptText(text, key) {
  if (!key) return text;
  
  const algorithm = 'aes-256-ctr';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(key, 'hex'), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return `${iv.toString('hex')}:${encrypted}`;
}

function decryptText(encryptedText, key) {
  if (!key || !encryptedText.includes(':')) return encryptedText;
  
  const algorithm = 'aes-256-ctr';
  const [ivHex, encrypted] = encryptedText.split(':');
  
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key, 'hex'), iv);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

function addNote(userId, title, content, options = {}) {
  const userData = getUserData(userId);
  const currentFolder = userData.currentFolder;
  const noteId = `note_${Date.now()}`;
  
  // Проверка на наличие settings
  if (!userData.settings) {
    userData.settings = {
      encryptionEnabled: false,
      encryptionKey: ''
    };
  }
  
  // Шифрование, если нужно
  let encryptedContent = content;
  let isEncrypted = false;
  if (options.encrypt && userData.settings.encryptionKey) {
    encryptedContent = encryptText(content, userData.settings.encryptionKey);
    isEncrypted = true;
  }
  
  // Создаем объект заметки
  userData.folders[currentFolder].notes[noteId] = {
    title,
    content: encryptedContent,
    isEncrypted,
    tags: options.tags || [],
    attachments: options.attachments || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  // Обновляем теги
  if (options.tags && options.tags.length > 0) {
    if (!userData.tags) userData.tags = {};
    
    options.tags.forEach(tag => {
      if (!userData.tags[tag]) {
        userData.tags[tag] = [noteId];
      } else if (!userData.tags[tag].includes(noteId)) {
        userData.tags[tag].push(noteId);
      }
    });
  }
  
  saveUserData(userId, userData);
  return noteId;
}

function updateNote(userId, noteId, updates = {}) {
  const userData = getUserData(userId);
  let noteFound = false;
  let folderId = null;
  
  // Проверка на наличие settings
  if (!userData.settings) {
    userData.settings = {
      encryptionEnabled: false,
      encryptionKey: ''
    };
  }
  
  // Поиск заметки
  Object.entries(userData.folders).forEach(([currentFolderId, folder]) => {
    if (folder.notes[noteId]) {
      folderId = currentFolderId;
      noteFound = true;
      const note = folder.notes[noteId];
      
      // Обновляем заголовок, если указан
      if (updates.title !== undefined) {
        note.title = updates.title;
      }
      
      // Обновляем содержимое, если указано
      if (updates.content !== undefined) {
        // Если заметка зашифрована, шифруем новое содержимое
        if (note.isEncrypted && userData.settings.encryptionKey) {
          note.content = encryptText(updates.content, userData.settings.encryptionKey);
        } else {
          note.content = updates.content;
        }
      }
      
      // Обновляем шифрование, если указано
      if (updates.encrypt !== undefined && userData.settings.encryptionKey) {
        if (updates.encrypt && !note.isEncrypted) {
          // Расшифровываем старое содержимое, если оно было зашифровано
          const decryptedContent = note.isEncrypted ? 
            decryptText(note.content, userData.settings.encryptionKey) : note.content;
          
          // Шифруем содержимое
          note.content = encryptText(decryptedContent, userData.settings.encryptionKey);
          note.isEncrypted = true;
        } else if (!updates.encrypt && note.isEncrypted) {
          // Расшифровываем содержимое
          note.content = decryptText(note.content, userData.settings.encryptionKey);
          note.isEncrypted = false;
        }
      }
      
      // Обновляем теги, если указаны
      if (updates.tags) {
        // Удаляем заметку из старых тегов
        if (note.tags) {
          note.tags.forEach(oldTag => {
            if (userData.tags[oldTag]) {
              userData.tags[oldTag] = userData.tags[oldTag].filter(id => id !== noteId);
              if (userData.tags[oldTag].length === 0) {
                delete userData.tags[oldTag];
              }
            }
          });
        }
        
        // Добавляем заметку в новые теги
        note.tags = updates.tags;
        updates.tags.forEach(tag => {
          if (!userData.tags) userData.tags = {};
          if (!userData.tags[tag]) {
            userData.tags[tag] = [noteId];
          } else if (!userData.tags[tag].includes(noteId)) {
            userData.tags[tag].push(noteId);
          }
        });
      }
      
      // Добавляем вложения, если указаны
      if (updates.attachments) {
        if (!note.attachments) note.attachments = [];
        note.attachments = [...note.attachments, ...updates.attachments];
      }
      
      // Удаляем вложения, если указаны
      if (updates.removeAttachments) {
        note.attachments = note.attachments.filter(a => !updates.removeAttachments.includes(a.id));
      }
      
      note.updatedAt = new Date().toISOString();
    }
  });
  
  if (noteFound) {
    // Если указана новая папка, перемещаем заметку
    if (updates.folderId && updates.folderId !== folderId) {
      const note = { ...userData.folders[folderId].notes[noteId] };
      userData.folders[updates.folderId].notes[noteId] = note;
      delete userData.folders[folderId].notes[noteId];
    }
    
    saveUserData(userId, userData);
    return true;
  }
  
  return false;
}

function getFolders(userId) {
  const userData = getUserData(userId);
  return Object.entries(userData.folders).map(([id, folder]) => ({
    id,
    name: folder.name
  }));
}

function setCurrentFolder(userId, folderId) {
  const userData = getUserData(userId);
  
  if (!userData.folders[folderId]) {
    return false;
  }
  
  userData.currentFolder = folderId;
  saveUserData(userId, userData);
  return true;
}

function getNotes(userId) {
  const userData = getUserData(userId);
  const currentFolder = userData.currentFolder;
  
  return Object.entries(userData.folders[currentFolder].notes).map(([id, note]) => ({
    id,
    title: note.title,
    content: note.isEncrypted ? null : note.content,
    isEncrypted: note.isEncrypted || false,
    tags: note.tags || [],
    attachments: note.attachments || [],
    createdAt: note.createdAt,
    updatedAt: note.updatedAt
  }));
}

function getNote(userId, noteId) {
  const userData = getUserData(userId);
  let foundNote = null;
  let folderName = '';
  
  Object.entries(userData.folders).forEach(([folderId, folder]) => {
    if (folder.notes[noteId]) {
      const note = folder.notes[noteId];
      
      // Расшифровываем, если нужно и возможно
      let content = note.content;
      if (note.isEncrypted && userData.settings.encryptionKey) {
        try {
          content = decryptText(content, userData.settings.encryptionKey);
        } catch (e) {
          content = null; // Ошибка расшифровки
        }
      }
      
      foundNote = {
        id: noteId,
        title: note.title,
        content: note.isEncrypted && !userData.settings.encryptionKey ? null : content,
        isEncrypted: note.isEncrypted || false,
        tags: note.tags || [],
        attachments: note.attachments || [],
        folderId,
        folderName: folder.name,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      };
      
      folderName = folder.name;
    }
  });
  
  return foundNote;
}

function searchNotes(userId, query) {
  const userData = getUserData(userId);
  const results = [];
  
  // Поиск по тегам, если запрос начинается с #
  if (query.startsWith('#') && userData.tags) {
    const tag = query.substring(1).toLowerCase();
    const matchingTags = Object.keys(userData.tags).filter(t => 
      t.toLowerCase().includes(tag)
    );
    
    matchingTags.forEach(matchedTag => {
      userData.tags[matchedTag].forEach(noteId => {
        // Находим папку с этой заметкой
        Object.entries(userData.folders).forEach(([folderId, folder]) => {
          if (folder.notes[noteId]) {
            const note = folder.notes[noteId];
            
            // Пропускаем зашифрованные заметки при поиске
            if (note.isEncrypted) return;
            
            results.push({
              id: noteId,
              folderId,
              folderName: folder.name,
              title: note.title,
              content: note.content,
              tags: note.tags || [],
              isEncrypted: note.isEncrypted || false,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt
            });
          }
        });
      });
    });
    
    return results;
  }
  
  // Обычный поиск по заголовку и содержимому
  Object.entries(userData.folders).forEach(([folderId, folder]) => {
    Object.entries(folder.notes).forEach(([noteId, note]) => {
      // Пропускаем зашифрованные заметки при поиске
      if (note.isEncrypted) return;
      
      if (
        note.title.toLowerCase().includes(query.toLowerCase()) ||
        note.content.toLowerCase().includes(query.toLowerCase())
      ) {
        results.push({
          id: noteId,
          folderId,
          folderName: folder.name,
          title: note.title,
          content: note.content,
          tags: note.tags || [],
          isEncrypted: note.isEncrypted || false,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt
        });
      }
    });
  });
  
  return results;
}

function deleteNote(userId, noteId) {
  const userData = getUserData(userId);
  let deleted = false;
  
  // Удаляем заметку из папок
  Object.keys(userData.folders).forEach(folderId => {
    if (userData.folders[folderId].notes[noteId]) {
      const note = userData.folders[folderId].notes[noteId];
      
      // Удаляем заметку из тегов
      if (note.tags && userData.tags) {
        note.tags.forEach(tag => {
          if (userData.tags[tag]) {
            userData.tags[tag] = userData.tags[tag].filter(id => id !== noteId);
            if (userData.tags[tag].length === 0) {
              delete userData.tags[tag];
            }
          }
        });
      }
      
      // Удаляем вложения, если есть
      if (note.attachments && note.attachments.length > 0) {
        const userFolderPath = path.join(config.dataFolder, userId.toString());
        note.attachments.forEach(attachment => {
          const attachmentPath = path.join(userFolderPath, 'attachments', attachment.id);
          if (fs.existsSync(attachmentPath)) {
            fs.unlinkSync(attachmentPath);
          }
        });
      }
      
      delete userData.folders[folderId].notes[noteId];
      deleted = true;
    }
  });
  
  if (deleted) {
    saveUserData(userId, userData);
  }
  
  return deleted;
}

function deleteFolder(userId, folderId) {
  const userData = getUserData(userId);
  
  if (folderId === 'root') {
    return false;
  }
  
  if (!userData.folders[folderId]) {
    return false;
  }
  
  // Удаляем все заметки из папки и их теги
  const folderNotes = userData.folders[folderId].notes;
  Object.keys(folderNotes).forEach(noteId => {
    const note = folderNotes[noteId];
    
    // Удаляем заметку из тегов
    if (note.tags && userData.tags) {
      note.tags.forEach(tag => {
        if (userData.tags[tag]) {
          userData.tags[tag] = userData.tags[tag].filter(id => id !== noteId);
          if (userData.tags[tag].length === 0) {
            delete userData.tags[tag];
          }
        }
      });
    }
    
    // Удаляем вложения, если есть
    if (note.attachments && note.attachments.length > 0) {
      const userFolderPath = path.join(config.dataFolder, userId.toString());
      note.attachments.forEach(attachment => {
        const attachmentPath = path.join(userFolderPath, 'attachments', attachment.id);
        if (fs.existsSync(attachmentPath)) {
          fs.unlinkSync(attachmentPath);
        }
      });
    }
  });
  
  // Если удаляемая папка является текущей, переключаемся на корневую
  if (userData.currentFolder === folderId) {
    userData.currentFolder = 'root';
  }
  
  delete userData.folders[folderId];
  saveUserData(userId, userData);
  return true;
}

function getTags(userId) {
  const userData = getUserData(userId);
  if (!userData.tags) return [];
  
  return Object.keys(userData.tags).map(tag => ({
    name: tag,
    count: userData.tags[tag].length
  }));
}

function saveAttachment(userId, fileData, fileName, fileType) {
  const userFolderPath = path.join(config.dataFolder, userId.toString());
  const attachmentsPath = path.join(userFolderPath, 'attachments');
  
  if (!fs.existsSync(attachmentsPath)) {
    fs.mkdirSync(attachmentsPath, { recursive: true });
  }
  
  const fileId = `attachment_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const filePath = path.join(attachmentsPath, fileId);
  
  fs.writeFileSync(filePath, fileData);
  
  return {
    id: fileId,
    name: fileName,
    type: fileType,
    size: fileData.length,
    createdAt: new Date().toISOString()
  };
}

function getAttachment(userId, attachmentId) {
  const userFolderPath = path.join(config.dataFolder, userId.toString());
  const attachmentPath = path.join(userFolderPath, 'attachments', attachmentId);
  
  if (!fs.existsSync(attachmentPath)) {
    return null;
  }
  
  return fs.readFileSync(attachmentPath);
}

function setEncryptionKey(userId, key) {
  const userData = getUserData(userId);
  
  // Генерируем 256-битный ключ из пароля пользователя
  const hash = crypto.createHash('sha256');
  hash.update(key);
  const encryptionKey = hash.digest('hex');
  
  userData.settings.encryptionKey = encryptionKey;
  userData.settings.encryptionEnabled = true;
  
  saveUserData(userId, userData);
  return true;
}

function toggleEncryption(userId, enabled) {
  const userData = getUserData(userId);
  
  if (!userData.settings.encryptionKey && enabled) {
    return false; // Нельзя включить шифрование без ключа
  }
  
  userData.settings.encryptionEnabled = enabled;
  saveUserData(userId, userData);
  return true;
}

module.exports = {
  getUserData,
  saveUserData,
  createFolder,
  addNote,
  updateNote,
  getFolders,
  setCurrentFolder,
  getNotes,
  getNote,
  searchNotes,
  deleteNote,
  deleteFolder,
  getTags,
  saveAttachment,
  getAttachment,
  setEncryptionKey,
  toggleEncryption
}; 