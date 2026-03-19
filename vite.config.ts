import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const ORDS_BASE_URL =
    env.VITE_ORDS_BASE_URL ||
    'https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      open: false,
      proxy: {
        '/api-check-user': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api-check-user/, '/check_user')
        },
        '/api-bet-user-inf': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api-bet-user-inf/, '/bet_user_inf')
        },
        '/api-get-user-inf': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api-get-user-inf/, '/get_user_inf')
        },
        '/api-get-produto-cadastro': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api-get-produto-cadastro/, '/get_produto_cadastro')
        }
      }
    }
  };
});
