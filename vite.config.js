import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Change 'ordergen' below to match your GitHub repository name exactly
// e.g. if your repo is github.com/yourname/order-tool, set base: '/order-tool/'
// If you're deploying to a custom domain (self-hosted), set base: '/'
export default defineConfig({
  plugins: [react()],
  base: '/order-generator/',
})
