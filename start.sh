#!/bin/bash
cd backend
npm install
npm run build
node dist/server.js
