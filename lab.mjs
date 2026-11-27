export const models = {
  terra: 'gpt-5.6-terra',
  luna: 'gpt-5.6-luna',
  sol: 'gpt-6.2-sol',
}

export const offer = {
  niche: 'Онлайн-школа предметной фотографии «Фокус»',
  task: 'Выяснить задачу и ограничения клиента, подобрать подходящий курс или объяснить, почему подходящего варианта нет.',
  courses: [
    '«Мобильный старт» — 6 900 ₽, 4 недели, уроки в записи, 2–3 часа в неделю. Достаточно смартфона и окна. Для начинающих, которые снимают товары для своего магазина. Индивидуальной проверки работ нет.',
    '«Студийная практика» — 14 900 ₽, 6 недель, живые разборы по средам в 19:00 МСК, 4–5 часов в неделю. Нужны камера с ручными настройками и источник постоянного света. Есть индивидуальная обратная связь. Для освоения студийного света и коммерческой съёмки.',
  ],
  rules: 'Оплата целиком. Рассрочки, скидок и записей живых разборов нет. Трудоустройство, заказы и доход школа не гарантирует. Пробный урок «Мобильного старта» и программа «Студийной практики» доступны по запросу без оплаты.',
}

export const rubric = '0 — критерий пропущен или нарушен. 1 — выполнен частично: есть нужный шаг, но важная деталь упущена. 2 — выполнен полностью, что видно в реплике продавца.'

export class LabError extends Error {}

const string = { type: 'string' }
const integer = { type: 'integer' }
const list = items => ({ type: 'array', items })
const object = properties => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
})

async function ask(model, instructions, input, format, maxOutput = 1200) {
  if (!process.env.OPENAI_API_KEY) {
    throw new LabError('Для нового прогона нужен OPENAI_API_KEY в окружении сервера.')
  }

  let response
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model, instructions, input, store: false,
        max_output_tokens: maxOutput,
        ...(format && { text: { format: {
          type: 'json_schema', name: format.name, schema: format.schema, strict: true,
        } } }),
      }),
      signal: AbortSignal.timeout(100_000),
    })
  } catch (error) {
    const cause = error.cause?.code
    throw new LabError(`Не удалось связаться с OpenAI${cause ? ` (${cause})` : ''}. Попробуйте ещё раз.`)
  }

  const data = await response.json()
  if (!response.ok) {
    const detail = data.error?.code
    const code = typeof detail === 'string' && /^[a-z0-9_]+$/i.test(detail) ? ` · ${detail}` : ''
    throw new LabError(`OpenAI вернул ошибку (${response.status}${code}).`)
  }
  const answer = data.output?.flatMap(item => item.content ?? [])
    .filter(item => item.type === 'output_text').map(item => item.text).join('').trim()
  if (data.status !== 'completed' || !answer) {
    throw new LabError(`OpenAI не вернул полный ответ (${data.incomplete_details?.reason ?? 'пустой ответ'}).`)
  }
  return format ? JSON.parse(answer) : answer
}

export async function prepare() {
  const schema = object({
    initial: string,
    scenarios: list(object({
      title: string, client: string, goal: string, constraints: string, opening: string,
      behavior: string, criteria: list(object({ title: string, rule: string })),
    })),
  })
  const result = await ask(models.terra,
    'Ты методист, готовишь эксперимент по автопромптингу продавца. Отвечай на русском.',
    `Каталог и задача: ${JSON.stringify(offer)}
Подготовь реалистичный короткий исходный системный промпт продавца, общий для всей ниши (каталог передадим модели отдельным блоком). Он должен отражать цель подбора и фактические условия, без пошагового алгоритма. Не ухудшай промпт намеренно.
Подготовь ровно три заранее заданных сценария. 1: продавец изделий хочет снимать товары смартфоном, бюджет до 8 000 ₽, тревожится, что не освоит без поддержки. 2: фотограф хочет коммерческий студийный свет, камера и постоянный свет уже есть, готов заниматься по средам, бюджет до 16 000 ₽, спрашивает про гарантии заказов. 3: клиенту нужен студийный свет и индивидуальные разборы, бюджет достаточный, есть техника, но он работает по средам в 19:00 и может учиться только в записи.
Для каждого: короткое заглавие из 2–4 слов, имя клиента, цель, ограничения, законченная первая реплика и приватное поведение. Скрывай второстепенные факты до вопроса или рекомендации. Все ключевые факты должны быть доступны до третьей реплики продавца, если он спрашивает по делу. Предусмотри ровно три проверяемых критерия для каждого, с конкретным условием полного балла. Критерии должны проверять диагностику, пригодность рекомендации или обоснованный отказ и честный следующий шаг либо работу с сомнением. Они применяются к трём ответам продавца.`,
    { name: 'materials', schema }, 3600)
  if (result.scenarios.length !== 3 || result.scenarios.some(s => s.criteria.length !== 3)) {
    throw new LabError('Terra вернула неполный набор сценариев или критериев.')
  }
  return {
    ...result,
    scenarios: result.scenarios.map((scenario, index) => ({
      ...scenario, id: ['mobile', 'studio', 'schedule'][index], holdout: index === 2,
    })),
    models, offer,
  }
}

export async function runDialog(scenario, prompt) {
  const dialog = [{ role: 'buyer', text: scenario.opening }]
  const sellerInstructions = `${prompt}

Каталог школы и условия (источник фактов):
${JSON.stringify(offer)}`
  const buyerInstructions = `Ты клиент по имени ${scenario.client}. Оставайся в роли.
Цель: ${scenario.goal}
Ограничения: ${scenario.constraints}
Поведение: ${scenario.behavior}
Ответь одной короткой естественной репликой от лица клиента. Не придумывай факты, меняющие условия сценария.`

  for (let turn = 0; turn < 3; turn++) {
    const seller = await ask(models.luna, sellerInstructions,
      dialog.map(item => ({ role: item.role === 'buyer' ? 'user' : 'assistant', content: item.text })))
    dialog.push({ role: 'seller', text: seller })
    if (turn < 2) {
      const buyer = await ask(models.terra, buyerInstructions,
        dialog.map(item => ({ role: item.role === 'seller' ? 'user' : 'assistant', content: item.text })))
      dialog.push({ role: 'buyer', text: buyer })
    }
  }
  return dialog
}

export async function evaluate(scenario, dialog) {
  const schema = object({
    valid: { type: 'boolean' },
    fidelity: string,
    criteria: list(object({ score: { type: 'integer', enum: [0, 1, 2] }, comment: string, turn: integer, quote: string })),
    takeaway: string,
  })
  const numberedDialog = dialog.map((item, i) => ({ ...item, turn: i + 1 }))
  const grade = await ask(models.sol,
    `Ты независимый оценщик диалога продавца. Оцени по шкале: ${rubric}
Не угадывай намерения. Учитывай только сказанное в диалоге и каталог. Сначала проверь, не противоречит ли клиент сценарию и не выдал ли скрытые факты вопреки сценарию. Простое отсутствие вопросов продавца не делает прогон невалидным. Если клиент существенно нарушил сценарий, отметь valid=false и объясни. Для каждого критерия строго в исходном порядке верни балл и конкретное замечание. Укажи номер реплики продавца и точную непрерывную цитату из неё (без добавленных кавычек или многоточия), подтверждающую оценку. При отсутствии релевантной реплики используй turn=0 и пустую цитату. Takeaway — самое существенное наблюдение одним предложением. Ответ по-русски.`,
    JSON.stringify({ offer, scenario, dialog: numberedDialog }),
    { name: 'evaluation', schema }, 3000)

  if (grade.criteria.length !== scenario.criteria.length) {
    throw new LabError('Оценщик вернул неверное число критериев.')
  }
  for (const criterion of grade.criteria) {
    if (criterion.turn === 0 && criterion.quote === '') continue
    const line = dialog[criterion.turn - 1]
    if (line?.role !== 'seller' || !criterion.quote || !line.text.includes(criterion.quote)) {
      throw new LabError('Оценщик привёл цитату, которую не удалось сверить с диалогом.')
    }
  }
  return { ...grade, total: grade.criteria.reduce((sum, item) => sum + item.score, 0) }
}

export async function optimize(initial, baseline) {
  return ask(models.sol,
    'Ты оптимизатор промпта консультанта. Разбери замечания независимого оценщика, найди повторяемые причины, предложи компактную инструкцию для любых клиентов этой школы. Каталог будет передан продавцу неизменным отдельным блоком. Не встраивай частные имена, сценарии и номера критериев. Не выдумывай условия. Используй только замечания из переданных прогонов. Ответ по-русски.',
    JSON.stringify({ offer, initial, baseline: baseline.map(({ scenario, grade }) => ({
      criteria: scenario.criteria.map((criterion, index) => ({ ...criterion, ...grade.criteria[index] })),
      takeaway: grade.takeaway,
    })) }),
    { name: 'optimization', schema: object({ final: string, changes: list(string) }) }, 3600)
}
