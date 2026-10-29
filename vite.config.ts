import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dataApi } from './server/dataApi'

export default defineConfig({
  plugins: [react(), dataApi()],
})
