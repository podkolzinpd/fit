import { expect, test } from '@playwright/test'

test('trainer publishes a profile and athlete finds it in the catalog', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/profile/trainer')
  await expect(page).toHaveURL(/profile$/)
  await expect(page.getByRole('link', { name: 'Анкета тренера' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Настройки профиля' })).toBeVisible()
  const coachmarkDismiss = page.getByRole('button', { name: 'Понятно' })
  if (await coachmarkDismiss.isVisible()) await coachmarkDismiss.click()
  const profile = page.getByRole('region', { name: 'Анкета тренера' })
  const editAction = profile.getByRole('button', { name: /Редактировать|Заполнить анкету/ })
  await expect(editAction).toBeVisible()
  const existingUnpublishButton = profile.locator('button', { hasText: 'Снять с публикации' })
  if (await existingUnpublishButton.count()) {
    await expect(existingUnpublishButton).toBeVisible()
    const unpublishRequest = page.waitForResponse((response) => response.url().includes('/rpc/unpublish_trainer_profile'))
    await existingUnpublishButton.click()
    await page.getByRole('button', { name: 'Снять', exact: true }).click()
    expect((await unpublishRequest).status()).toBe(200)
    await expect(existingUnpublishButton).toHaveCount(0)
  }
  if (await profile.getByText('Анкета пока не заполнена').isVisible()) {
    const minimalPublishButton = profile.getByRole('button', { name: 'Опубликовать', exact: true })
    await expect(minimalPublishButton).toBeVisible()
    await expect(profile.getByRole('button', { name: 'Заполнить анкету' })).toBeVisible()
    await minimalPublishButton.click()
    await expect(profile.getByText('Видна в каталоге')).toBeVisible()
    const minimalUnpublish = profile.getByRole('button', { name: 'Снять с публикации' })
    await expect(minimalUnpublish).toBeVisible()
    await minimalUnpublish.click()
    await page.getByRole('button', { name: 'Снять', exact: true }).click()
    await expect(minimalUnpublish).toHaveCount(0)
  }
  await editAction.click()
  const editor = profile.getByRole('form', { name: 'Редактирование анкеты тренера' })
  await expect(editor).toHaveClass(/trainer-profile-edit-card/)
  await expect(editor.locator('.trainer-profile-fields')).toHaveCount(0)
  await editor.getByLabel('Имя в анкете').fill('Анна Иванова')
  await editor.getByLabel('О себе').fill('Помогаю безопасно начать силовые тренировки, встроить движение в обычную жизнь и видеть понятный прогресс без перегрузки.')
  await editor.getByText(/^Направления · \d\/6$/).click()
  await editor.getByRole('checkbox', { name: 'Тренажёрный зал / силовой тренинг' }).check()
  await editor.getByRole('checkbox', { name: 'Похудение и коррекция фигуры' }).check()
  await editor.getByRole('switch', { name: 'Онлайн' }).check()
  await editor.getByRole('switch', { name: 'Лично' }).check()
  await editor.getByRole('switch', { name: 'Беру новых клиентов' }).check()
  await editor.getByLabel('Город').fill('Москва')
  if (await editor.getByRole('button', { name: 'Убрать станцию Динамо' }).count() === 0) {
    await editor.getByRole('combobox', { name: 'Метро Москвы' }).fill('Динамо')
    await editor.getByRole('option', { name: /Динамо/ }).click()
  }
  await editor.getByLabel('Клуб, район или адрес').fill('World Class Динамо')
  await editor.getByRole('button', { name: 'Добавить', exact: true }).click()
  await editor.getByLabel('Как проходят занятия').fill('Созваниваемся раз в неделю и корректируем план.')
  await editor.locator('input[type="file"]').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  })
  // Upload saves and replaces the draft asynchronously. Continue only after
  // its result is rendered, not merely after the file input's change event.
  await expect(editor.getByLabel('Выбрать фото')).toBeEnabled()
  await expect(editor.getByRole('status')).toHaveText('Сохранено')
  await editor.locator('summary').filter({ hasText: /^Образование и сертификаты/ }).click()
  const certificates = editor.locator('.trainer-certificates-editor')
  // A retry can see the draft saved by the preceding attempt.
  while (await certificates.getByRole('button', { name: 'Удалить', exact: true }).count()) {
    await certificates.getByRole('button', { name: 'Удалить', exact: true }).first().click()
  }
  await editor.getByLabel('Образование и квалификация').fill('Высшее физкультурное образование.')
  await editor.getByRole('button', { name: 'Добавить сертификат' }).click()
  await editor.getByLabel('Название сертификата 1').fill('Персональный тренер')
  await editor.getByLabel('Организация 1').fill('Fit Academy')
  await editor.getByLabel('Год сертификата 1').fill('2025')
  await editor.getByRole('button', { name: 'Сохранить' }).click()
  await expect(profile.getByRole('heading', { name: 'Анна Иванова' })).toBeVisible()
  await expect(profile.getByRole('button', { name: 'Редактировать' })).toBeVisible()
  await expect(profile.locator('img.trainer-card-avatar')).toBeVisible()
  await profile.getByText('Где тренирует · 2').click()
  await expect(profile.getByRole('list', { name: 'Станции метро' })).toContainText('Динамо')
  await expect(profile.getByRole('list', { name: 'Места тренировок' })).toContainText('World Class Динамо')
  await profile.getByText('Образование и сертификаты · 1').click()
  await expect(profile.getByText('Высшее физкультурное образование.')).toBeVisible()
  await expect(profile.getByText('Персональный тренер')).toBeVisible()
  const publishButton = profile.getByRole('button', { name: 'Опубликовать', exact: true })
  await expect(publishButton).toBeVisible()
  await publishButton.click()
  const publication = profile.locator('.trainer-publication-disclosure')
  await expect(publication.getByText('Видна в каталоге')).toBeVisible()
  await publication.locator('summary').click()
  await expect(publication.getByRole('switch', { name: 'Показывать в каталоге' })).toBeChecked()
  const publicLink = await publication.getByRole('link', { name: 'Открыть анкету' }).getAttribute('href')
  expect(publicLink).toMatch(/^\/trainers\/[0-9a-f-]+$/)
  const publicRequest = page.waitForResponse((response) => response.url().includes('/rpc/get_public_trainer_profile'))
  await page.goto(publicLink!)
  const publicResponse = await publicRequest
  expect(publicResponse.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Анна Иванова' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Где тренирует' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Станции метро' })).toContainText('Динамо')
  await page.getByRole('button', { name: 'Открыть фото тренера Анна Иванова' }).click()
  await expect(page.getByRole('dialog', { name: 'Фото тренера' })).toBeVisible()
  await page.getByRole('button', { name: 'Увеличить' }).click()
  await expect(page.getByText('150%')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть фото' }).click()
  await expect(page.getByRole('dialog', { name: 'Фото тренера' })).toHaveCount(0)
  await expect(page.getByText('Спортсмены видят последнюю опубликованную версию.')).toHaveCount(0)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  await page.goto('/profile')
  const profileAfterPublish = page.getByRole('region', { name: 'Анкета тренера' })
  await profileAfterPublish.locator('.trainer-publication-disclosure summary').click()
  const catalogSwitch = profileAfterPublish.getByRole('switch', { name: 'Показывать в каталоге' })
  await expect(catalogSwitch).toBeChecked()

  await page.getByRole('link', { name: 'Настройки профиля' }).click()
  await expect(page).toHaveURL(/\/profile\/settings$/)
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/auth$/)
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/me/profile')
  await page.getByRole('link', { name: /Найти тренера/ }).click()
  await expect(page).toHaveURL(/\/me\/trainers$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Тренеры' })).toBeVisible()
  const results = page.getByRole('region', { name: 'Найденные тренеры' })
  await expect(results.getByRole('heading', { name: 'Анна Иванова' })).toBeVisible()

  await page.getByRole('button', { name: 'Фильтры' }).click()
  await page.locator('.trainer-catalog-specialty-disclosure summary').click()
  await page.getByRole('checkbox', { name: 'Похудение и коррекция фигуры' }).check()
  await page.getByRole('combobox', { name: 'Метро' }).fill('Динамо')
  await page.getByRole('option', { name: /Динамо/ }).click()
  await page.getByRole('button', { name: 'Показать тренеров' }).click()
  await expect(page.getByRole('button', { name: 'Фильтры · 2' })).toBeVisible()
  await expect(results.getByRole('heading', { name: 'Анна Иванова' })).toBeVisible()
  await results.getByRole('link', { name: 'Посмотреть анкету' }).click()
  await expect(page).toHaveURL(/\/trainers\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: 'Анна Иванова' })).toBeVisible()
  const publicPage = page.locator('.public-trainer-page')
  const contactButton = page.getByRole('button', { name: 'Написать тренеру' })
  await expect(contactButton).toBeVisible()
  await expect(publicPage.evaluate((element) => element.scrollHeight > element.clientHeight)).resolves.toBe(true)
  await publicPage.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await expect(contactButton).toBeVisible()
  const contactBounds = await contactButton.boundingBox()
  expect(contactBounds).not.toBeNull()
  expect(contactBounds!.y + contactBounds!.height).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight))
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/me\/trainers$/)
  await expect(page.getByRole('button', { name: 'Фильтры · 2' })).toBeVisible()
  await page.getByRole('button', { name: 'Фильтры · 2' }).click()
  await page.locator('.trainer-catalog-specialty-disclosure summary').click()
  await expect(page.getByRole('checkbox', { name: 'Похудение и коррекция фигуры' })).toBeChecked()
  await expect(page.getByRole('list', { name: 'Выбранные станции метро' })).toContainText('Динамо')
  await page.getByRole('button', { name: 'Закрыть фильтры' }).click()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  await page.goto('/me/settings')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/auth$/)
  await page.goto(publicLink!)
  await page.getByRole('link', { name: 'Войти, чтобы написать' }).click()
  await expect(page).toHaveURL(/\/auth$/)
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(new RegExp(`${publicLink}$`))
  await expect(page.getByRole('heading', { name: 'Анна Иванова' })).toBeVisible()
})

test('athlete loads every page of the trainer catalog', async ({ page }) => {
  const draft = (displayName: string) => ({
    displayName, bio: '', specialties: [], city: '', trainingModes: [], experienceStartYear: null,
    education: '', formats: '', price: '', acceptingClients: true, avatarDataUrl: null, certificates: [],
  })
  const profile = (index: number) => {
    const published = draft(`Тренер ${String(index).padStart(2, '0')}`)
    return {
      publicId: `92000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      draft: published, published, listedInCatalog: true,
      publishedAt: '2026-09-13T01:00:00Z', updatedAt: '2026-09-13T01:00:00Z', version: 1,
      isBrandTrainer: false,
    }
  }
  await page.route('**/rest/v1/rpc/list_public_trainer_profiles_page', (route) => {
    const request = route.request().postDataJSON() as { p_offset?: number }
    const offset = request.p_offset ?? 0
    const items = offset === 0 ? Array.from({ length: 20 }, (_, index) => profile(index + 1)) : [profile(21)]
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, totalCount: 21, nextOffset: offset === 0 ? 20 : null }) })
  })

  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await page.goto('/me/trainers')

  await expect(page.getByText('Найдено: 21')).toBeVisible()
  await expect(page.locator('.trainer-catalog-card')).toHaveCount(20)
  await page.getByRole('button', { name: 'Показать ещё' }).click()
  await expect(page.locator('.trainer-catalog-card')).toHaveCount(21)
  await expect(page.getByRole('heading', { name: 'Тренер 21' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0)
})
