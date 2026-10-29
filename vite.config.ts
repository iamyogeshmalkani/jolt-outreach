import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dataApi } from './server/dataApi'

export default defineConfig({
  // The online version is served from /<repo-name>/, set by the deploy workflow.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), dataApi()],
})
