import { copyFile, mkdir } from 'node:fs/promises'

const publicFile = name => new URL(`../public/${name}`, import.meta.url)
const outputFile = name => new URL(`../dist/${name}`, import.meta.url)

await mkdir(outputFile(''), { recursive: true })
for (const name of ['index.html', 'app.js', 'styles.css', 'onest-cyrillic.woff2', 'onest-latin.woff2', 'ONEST-OFL.txt']) {
  await copyFile(publicFile(name), outputFile(name))
}
