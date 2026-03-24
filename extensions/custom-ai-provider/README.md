# Custom AI Translator

Custom AI Translator is a Raycast extension that lets you translate text with your own third-party AI provider.

Instead of locking you into a single service, the extension sends translation requests to the exact endpoint you configure in Raycast preferences.

## Features

- Configure a single custom AI provider in Raycast preferences
- Set `Base URL`, `API Key`, default model, extra headers, and timeout
- Translate text into both Simplified Chinese and English
- Auto-detect the source language
- Use your own full request URL without automatic path rewriting
- Quickly translate the selected text from the frontmost app

## Setup

1. Run `npm install`
2. Run `npm run dev`
3. Open the extension preferences in Raycast
4. Fill in your provider settings, for example:
   - Provider Name: `ChatGPT`
   - Base URL: `https://api.openai.com/v1/chat/completions`
   - API Key: your key
   - Model: `gpt-5.4`
5. Open `Custom AI Translator`
6. Type or paste text and press Enter to translate

## Provider Notes

- `Base URL` is used as the final request URL exactly as entered
- No API path is appended automatically
- If your provider expects a full endpoint such as `/chat/completions`, enter the complete URL
- Extra headers support two formats:
  - JSON: `{"X-Source":"raycast"}`
  - One header per line: `X-Source: raycast`

## Commands

- `Custom AI Translator`: open the main translation interface
- `Translate Selected Text`: translate the current selection from the frontmost app

## Development

- `npm run lint`: validate the extension and formatting
- `npm run build`: build and validate the extension for distribution
- `npm run publish`: publish the extension through the Raycast publishing flow
