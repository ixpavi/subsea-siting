import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  build: {
    // Vite's default CSS target lets the minifier rewrite `@media (max-width:
    // 760px)` into Media Queries Level 4 range syntax, `@media (width <=
    // 760px)`. That syntax only landed in Safari 16.4 (March 2023), and a
    // browser that does not understand the query drops the entire block --
    // which here is the whole phone layout. The devices most likely to be
    // running an older Safari are exactly the phones that layout exists for,
    // so the saving of a few bytes is not worth it.
    //
    // Verify after changing: `grep -o "@media[^{]*" dist/assets/*.css` must
    // show `max-width:760px`, not `width<=760px`.
    cssTarget: ['chrome87', 'safari14', 'firefox78', 'edge88'],
  },
})
