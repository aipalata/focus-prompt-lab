import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { rubric } from '../lab.mjs'

const publicFile = name => new URL(`../public/${name}`, import.meta.url)
const outputFile = name => new URL(`../dist/${name}`, import.meta.url)

await mkdir(outputFile(''), { recursive: true })
for (const name of ['index.html', 'app.js', 'styles.css', 'onest-cyrillic.woff2', 'onest-latin.woff2', 'ONEST-OFL.txt']) {
  await copyFile(publicFile(name), outputFile(name))
}

const input = await readFile(new URL('../data/experiment.json', import.meta.url), 'utf8')
const experiment = JSON.parse(input)
const archive = {
  scenarios: experiment.scenarios,
  offer: experiment.offer,
  models: experiment.models,
  initial: experiment.initial,
  final: experiment.final,
  runs: experiment.runs,
  rubric,
  canRun: false,
}
await writeFile(outputFile('experiment.json'), JSON.stringify(archive))
