# Useful Notepad in Telegram

Telegram bot for storing important information, passwords and notes with the ability to create folders and search.

## Features

- Create and manage folders to organize notes
- Add notes with title and content
- Search through notes
- View list of notes in the selected folder
- Delete notes and folders

## Installation and Startup

1. Clone the repository:
```
git clone https://github.com/Maks0101aps/-Useful-Notepad-in-TELEGRAM.git
cd -Useful-Notepad-in-TELEGRAM
```

2. Install dependencies:
```
npm install
```

3. Create a `.env` file in the project root with the following content:
```
BOT_TOKEN=your_telegram_bot_token_here
```
Replace `your_telegram_bot_token_here` with your bot token obtained from [@BotFather](https://t.me/BotFather).

4. Start the bot:
```
npm start
```

For development, you can use the command:
```
npm run dev
```

## Bot Commands

- `start` - start working with the bot
- `help` - show help
- `folders` - manage folders
- `createfolder` - create a new folder
- `note` - create a new note
- `notes` - view notes in the current folder
- `search` - search through notes

## Project Structure

- `index.js` - main bot file
- `config.js` - bot configuration
- `database.js` - user data management
- `commands.js` - bot command handlers
- `data/` - folder for storing user data (created automatically)

## Requirements

- Node.js 14.0 or higher
- npm 6.0 or higher 