import { fulfillTrainingData, trainingPageParams } from './native-workout-fixture'
import { workoutFixture, exerciseFixture, setFixture } from './native-workout-fixture'
import { nativeSignIn } from './native-local-fixture';
import { nativeRegister } from './native-local-fixture';
import { expect, test } from './native-local-fixture';
import type { Page } from './native-local-fixture';
import { randomUUID } from 'node:crypto';
const historyRow = workoutFixture({
    id: 'c1000000-0000-4000-8000-000000000001',
    clientId: '11111111-1111-4111-8111-111111111111',
    trainerId: '22222222-2222-4222-8222-222222222222',
    clientName: 'Анна Смирнова',
    createdBy: '92000000-0000-4000-8000-000000000029',
    workoutDate: '2026-08-10',
    startTime: '18:00:00',
    endTime: '19:00:00',
    startedAt: '2026-08-10T15:00:00Z',
    completedAt: '2026-08-10T16:00:00Z',
    status: 'done',
    notes: null,
    trainerReview: null,
    trainerReaction: null,
    trainerReviewAuthorId: null,
    trainerReviewedAt: null,
    clientComment: null,
    sessionRpe: null,
    wellbeing: null,
    discomfort: false,
    hasPr: false,
    stageId: null,
    stageTitle: null,
    version: 1,
    exercises: []
});
test('client workout month calendar stays usable in iPhone WebKit', async ({ page }) => {
    test.setTimeout(60000);
    await page.route('**/v1/training-data?*', async (route) => {
        const body = trainingPageParams(route);
        const visible = (!body.from || historyRow.workoutDate >= body.from)
            && (!body.to || historyRow.workoutDate <= body.to);
        await fulfillTrainingData(route, visible ? [historyRow] : []);
    });
    await loginForHistory(page, 'client');
    await page.goto('/me/workouts?tab=history');
    await page.getByRole('button', { name: 'Календарь' }).click();
    await expect(page.getByRole('grid', { name: 'История тренировок за Август 2026' })).toBeVisible();
    const day = page.getByRole('button', { name: '10 августа 2026 г., 1 тренировка' });
    await expect(day).toBeVisible();
    await day.click();
    await expect(page.locator('.client-history-calendar-selection')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Список' })).toHaveCSS('min-height', '44px');
});
const trainerId = '90000000-0000-4000-8000-000000000009';
const clientHistoryPath = `/clients/${historyRow.clientId}/workouts`;
const detailPath = `/workouts/${historyRow.id}`;
const fixtureExercise = exerciseFixture({
    id: 'c2000000-0000-4000-8000-000000000001', position: 0,
    source: 'system', ref: 'plank', customExerciseId: null,
    name: 'Планка с длительным удержанием и контролем положения корпуса',
    muscleGroup: 'core', inputKind: 'duration', blockId: 'c3000000-0000-4000-8000-000000000001',
    blockType: 'single', blockPreset: 'set', blockRounds: 1,
    restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 60, trainerComment: null
});
const fixtureSet = setFixture({
    id: 'c4000000-0000-4000-8000-000000000001', position: 0,
    confirmedAt: '2026-08-10T15:01:00Z', version: 1,
    plan: { durationSec: 60 },
    fact: { durationSec: 60 }
});
function historyListExercises(confirmed: boolean) {
    return [
        { ...fixtureExercise, position: 0, sets: [{ ...fixtureSet, confirmedAt: confirmed ? fixtureSet.confirmedAt : null }] },
        { ...fixtureExercise, id: 'c2000000-0000-4000-8000-000000000002', ref: 'squat', name: 'Присед', muscleGroup: 'legs' as const, position: 1, blockId: 'c3000000-0000-4000-8000-000000000002', sets: [{ ...fixtureSet, id: 'c4000000-0000-4000-8000-000000000002', workout_exercise_id: 'c2000000-0000-4000-8000-000000000002', confirmedAt: confirmed ? fixtureSet.confirmedAt : null }] },
        { ...fixtureExercise, id: 'c2000000-0000-4000-8000-000000000003', ref: 'bench-press', name: 'Жим лёжа', muscleGroup: 'chest' as const, position: 2, blockId: 'c3000000-0000-4000-8000-000000000003', sets: [{ ...fixtureSet, id: 'c4000000-0000-4000-8000-000000000003', workout_exercise_id: 'c2000000-0000-4000-8000-000000000003', confirmedAt: confirmed ? fixtureSet.confirmedAt : null }] },
        { ...fixtureExercise, id: 'c2000000-0000-4000-8000-000000000004', ref: 'lat-pulldown', name: 'Тяга верхнего блока', muscleGroup: 'back' as const, position: 3, blockId: 'c3000000-0000-4000-8000-000000000004', sets: [{ ...fixtureSet, id: 'c4000000-0000-4000-8000-000000000004', workout_exercise_id: 'c2000000-0000-4000-8000-000000000004', confirmedAt: confirmed ? fixtureSet.confirmedAt : null }] },
    ];
}
async function mockNavigationWorkouts(page: Page) {
    const state = { status: 'done' as 'done' | 'planned' | 'in_progress', version: 1, deleted: false, empty: false, createdId: historyRow.id, monthError: false, delayMonth: false, count: 1, setConfirmed: true };
    const row = () => (workoutFixture({ ...historyRow, id: state.createdId, trainerId: trainerId, createdBy: trainerId,
        status: state.status, version: state.version, workoutDate: state.status !== 'done' ? '2026-08-16' : historyRow.workoutDate,
        startedAt: state.empty && state.status !== 'done' ? '2026-08-16T14:59:42Z' : historyRow.startedAt,
        exercises: state.empty ? [] : [{ ...fixtureExercise, sets: [{ ...fixtureSet, confirmedAt: state.setConfirmed ? fixtureSet.confirmedAt : null }] }]
    }));
    await page.route('**/v1/training-data?*', async (route) => {
        const body = trainingPageParams(route);
        if (body.from && body.to && body.from.endsWith('-01')) {
            if (state.delayMonth)
                await new Promise((resolve) => setTimeout(resolve, 700));
            if (state.monthError) {
                await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"test calendar unavailable"}' });
                return;
            }
        }
        const item = body.workoutId ? { ...row(), id: body.workoutId } : { ...row(), exercises: state.empty ? [] : historyListExercises(state.setConfirmed) };
        const visible = !state.deleted && (!body.from || item.workoutDate >= body.from) && (!body.to || item.workoutDate <= body.to);
        const rows = Array.from({ length: state.count }, (_, index) => ({ ...item, id: index === 0 ? item.id : `c1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
        await fulfillTrainingData(route, visible ? rows : []);
    });
    await page.route('**/v1/workouts/home?*', route => route.fulfill({ json: { workouts: state.deleted ? [] : [{ id: state.createdId, clientId: historyRow.clientId, clientName: historyRow.clientName, workoutDate: row().workoutDate, startTime: row().startTime, status: state.status, exerciseCount: state.empty ? 0 : 1, exerciseNames: state.empty ? [] : [fixtureExercise.name] }] } }))
    await page.route('**/v1/workouts/*/personal-records', route => route.fulfill({ json: { records: [] } }))
    await page.route('**/v1/clients/*/progress/exercises/*?*', route => route.fulfill({ json: { items: [], nextCursor: null } }))
    await page.route(/\/v1\/workouts(?:\/completed|\/[a-f0-9-]{36}(?:\/(?:completed|result))?)?$/, route => {
      if (route.request().method() === 'DELETE') {
        state.deleted = true
        return route.fulfill({ json: { workout: { version: ++state.version } } })
      }
      const parts = new URL(route.request().url()).pathname.split('/')
      state.createdId = parts[3] ?? 'c1000000-0000-4000-8000-000000000002'
      state.version += 1
      return route.fulfill({ json: { workout: { id: state.createdId } } })
    })
    await page.route('**/v1/workouts/*/cancel-empty', route => { state.deleted = true; return route.fulfill({ json: { workout: { version: ++state.version } } }) })
    await page.route('**/v1/workouts/*/start', route => {
      state.status = 'in_progress'; state.version += 1
      return route.fulfill({ json: { workout: { version: state.version } } })
    })
    await page.route('**/v1/workouts/*/finish', route => {
      state.status = 'done'; state.version += 1
      return route.fulfill({ json: { workout: { version: state.version } } })
    })
    return state;
}
async function loginForHistory(page: Page, role: 'trainer' | 'client') {
    await page.goto('/auth');
    await nativeSignIn(page, `${role}@fit.local`);
    await expect(page).toHaveURL(role === 'trainer' ? /\/today$/ : /\/me$/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
    await dismissVisibleHints(page);
    await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') });
}
async function dismissVisibleHints(page: Page) {
    const buttons = page.locator('.coachmark-bubble').getByRole('button', { name: 'Понятно', exact: true });
    while (await buttons.count())
        await buttons.first().click();
}
async function dismissCalendarHint(page: Page) {
    if (!new URL(page.url()).pathname.startsWith('/clients/'))
        return;
    await page.getByRole('group', { name: 'Вид истории тренировок' }).scrollIntoViewIfNeeded();
    const hint = page.locator('.coachmark-bubble').filter({ hasText: 'История по датам' });
    await expect(hint).toBeVisible();
    await hint.getByRole('button', { name: 'Понятно' }).click();
    await dismissVisibleHints(page);
}
for (const role of ['client', 'trainer'] as const) {
    test(`${role}: empty Live is compact and deletion stays safe`, async ({ page }, testInfo) => {
        const state = await mockNavigationWorkouts(page);
        state.status = 'in_progress';
        state.empty = true;
        if (role === 'trainer')
            await loginForHistory(page, role);
        else {
            await page.goto('/auth');
            await nativeRegister(page, { key: `live-empty-${randomUUID()}@fit.local`, firstName: 'Тестовый клиент', role: 'client' });
            await expect(page).toHaveURL(/\/me$/);
            await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') });
            const fixtureClient = {
                id: historyRow.clientId, auth_user_id: null, fullName: historyRow.clientName,
                canonicalFullName: historyRow.clientName, gender: null, ageYears: null,
                ageUpdatedAt: null, heightCm: null, goal: null, note: null,
                currentWeightKg: null, lastActivityAt: null, archivedAt: null,
                version: 1, membershipVersion: null, merged_into_client_id: null,
                canArchive: false, hasAccount: false
            };
            await page.route('**/v1/clients/me', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ client: fixtureClient }) }));
            await page.route("**/v1/clients", (route) => route.fulfill({ json: { clients: [fixtureClient] } }));
        }
        await page.goto(`${detailPath}/live`);
        await dismissVisibleHints(page);
        await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
        await expect(page.locator('.live-session-header .workout-status')).toHaveCount(0);
        await expect(page.locator('.live-session-progress')).toHaveCount(0);
        await expect(page.getByRole('progressbar', { name: 'Выполненные подходы' })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Добавьте первое упражнение' })).toBeVisible();
        await dismissVisibleHints(page);
        await expect(page.getByRole('button', { name: 'Выбрать упражнение' })).toBeVisible();
        await expect(page.getByText('Пустую тренировку нельзя завершить как выполненную.')).toHaveCount(0);
        const deleteButton = page.locator('.live-bottom-bar').getByRole('button', { name: 'Удалить тренировку' });
        await expect(page.locator('.live-bottom-bar button')).toHaveCount(role === 'trainer' ? 2 : 1);
        await expect(page.locator('.live-bottom-bar').getByRole('button', { name: 'Завершить тренировку', exact: true })).toHaveCount(role === 'trainer' ? 1 : 0);
        await expect(deleteButton.locator('[data-icon="trash"]')).toBeVisible();
        const hitTarget = await deleteButton.boundingBox();
        expect(hitTarget?.width).toBeGreaterThanOrEqual(44);
        expect(hitTarget?.height).toBeGreaterThanOrEqual(44);
        for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
            await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await expect(deleteButton).toBeInViewport();
            await page.screenshot({ path: testInfo.outputPath(`${role}-live-empty-${width}.png`), fullPage: true });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('html').evaluate((element) => element.classList.remove('theme-light'));
        await page.locator('.phone-frame').evaluate((element) => element.classList.remove('theme-light'));
        await expect(deleteButton).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath(`${role}-live-empty-dark-390.png`), fullPage: true });
        await deleteButton.click();
        await expect(page.getByRole('alertdialog', { name: 'Удалить эту пустую тренировку?' })).toBeVisible();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click();
        await expect(page).toHaveURL(`${detailPath}/live`);
        let failOnce = true;
        await page.route(`**/v1/workouts/${historyRow.id}/cancel-empty`, (route) => {
            if (failOnce) {
                failOnce = false;
                return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"temporarily unavailable"}' });
            }
            return route.fallback();
        });
        await deleteButton.click();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click();
        await expect(page.getByRole('alert')).toHaveText('Не удалось удалить тренировку. Попробуйте ещё раз.');
        await expect(deleteButton).toBeEnabled();
        await deleteButton.click();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click();
        await expect(page).toHaveURL(role === 'client' ? /\/me$/ : /\/today$/);
        state.deleted = false;
        state.empty = false;
        await page.goto(`${detailPath}/live`);
        await expect(page.locator('.live-session-progress')).toContainText('Готово 1 из 1');
        await expect(page.locator('.live-bottom-bar').getByRole('button', { name: 'Удалить тренировку' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Завершить тренировку' })).toBeVisible();
    });
}
for (const role of ['trainer', 'client'] as const) {
    test(`${role}: current and future plans remain visible beside history`, async ({ page }, testInfo) => {
        await mockNavigationWorkouts(page);
        const rows = [
            workoutFixture({ ...historyRow, id: 'c1000000-0000-4000-8000-000000000002', workoutDate: '2026-08-20', status: 'planned' }),
            workoutFixture({ ...historyRow, workoutDate: '2026-08-16', status: 'planned' }),
            workoutFixture({ ...historyRow, id: 'c1000000-0000-4000-8000-000000000003', workoutDate: '2026-08-16', status: 'in_progress' }),
            workoutFixture({ ...historyRow, id: 'c1000000-0000-4000-8000-000000000004', workoutDate: '2026-08-15', status: 'planned' }),
            { ...historyRow, id: 'c1000000-0000-4000-8000-000000000005' },
        ].map((row) => ({ ...row, createdBy: trainerId, trainerId: trainerId, exercises: historyListExercises(row.status === 'done') }));
        await page.route('**/v1/training-data?*', async (route) => {
            const body = trainingPageParams(route);
            const visible = rows.filter((row) => (!body.from || row.workoutDate >= body.from) && (!body.to || row.workoutDate <= body.to));
            await fulfillTrainingData(route, visible);
        });
        await loginForHistory(page, role);
        await page.goto(role === 'trainer' ? clientHistoryPath : '/me/workouts');
        await dismissCalendarHint(page);
        await page.screenshot({ path: testInfo.outputPath(`${role}-upcoming-initial.png`), fullPage: true });
        const upcoming = page.locator('.client-workout-section').filter({ has: page.getByRole('heading', { name: 'Предстоит', exact: true }) });
        await expect(upcoming.locator('.client-workout-card')).toHaveCount(3);
        await expect(upcoming.locator('.client-workout-card').first()).toContainText('16 августа 2026 г.');
        await expect(upcoming.locator('.client-workout-card').last()).toContainText('20 августа 2026 г.');
        await expect(page.locator('.past-workout-plan-card')).toHaveCount(1);
        if (role === 'trainer')
            await expect(page.locator('.workout-chronicle-card')).toHaveCount(1);
        else {
            await page.getByRole('tab', { name: 'История' }).click();
            await expect(page.locator('.workout-chronicle-card')).toBeVisible();
            await page.getByRole('tab', { name: 'Актуальное' }).click();
        }
        for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
            await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await upcoming.getByRole('heading', { name: 'Предстоит', exact: true }).scrollIntoViewIfNeeded();
            for (const card of await upcoming.locator('.client-workout-card').all()) {
                const bounds = await card.boundingBox();
                expect(bounds).not.toBeNull();
                expect(bounds!.x).toBeGreaterThanOrEqual(0);
                expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
            }
            await page.screenshot({ path: testInfo.outputPath(`${role}-upcoming-${width}.png`), fullPage: true });
        }
        if (role === 'trainer') {
            await page.getByRole('button', { name: 'Календарь', exact: true }).click();
            await expect(upcoming.locator('.client-workout-card')).toHaveCount(3);
            const source = page.url();
            await upcoming.locator(`a[href="${detailPath}"]`).click();
            await expect(page).toHaveURL(detailPath);
            await page.getByRole('button', { name: 'Назад', exact: true }).click();
            await expect(page).toHaveURL(source);
            await expect(upcoming.locator('.client-workout-card')).toHaveCount(3);
        }
        else {
            await page.getByRole('group', { name: 'Вид актуальных тренировок' }).getByRole('button', { name: 'Календарь' }).click();
            await expect(page.getByRole('grid', { name: 'Актуальные тренировки за Август 2026' })).toBeVisible();
            await page.getByRole('button', { name: '16 августа 2026 г., 2 тренировки' }).click();
            const source = page.url();
            await page.locator('.client-history-calendar-selection').locator(`a[href="${detailPath}"]`).click();
            await expect(page).toHaveURL(detailPath);
            await page.getByRole('button', { name: 'Назад', exact: true }).click();
            await expect(page).toHaveURL(source);
            await expect(page.locator('.client-history-calendar-day.selected')).toBeVisible();
        }
    });
}
test('client: many plans do not push list/calendar below the first screen and both tabs retain their view', async ({ page }, testInfo) => {
    await mockNavigationWorkouts(page);
    const rows = [
        ...Array.from({ length: 12 }, (_, index) => (workoutFixture({ ...historyRow,
            id: `c1000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`,
            workoutDate: `2026-08-${String(index + 17).padStart(2, '0')}`, status: 'planned' }))),
        workoutFixture({ ...historyRow, id: 'c1000000-0000-4000-8000-000000000099', workoutDate: '2026-10-11', status: 'planned' }),
        workoutFixture({ ...historyRow, id: 'c1000000-0000-4000-8000-000000000098', workoutDate: '2026-08-15', status: 'planned' }),
        historyRow,
    ];
    await page.route('**/v1/training-data?*', async (route) => {
        const body = trainingPageParams(route);
        const visible = rows.filter((row) => (!body.from || row.workoutDate >= body.from) && (!body.to || row.workoutDate <= body.to));
        await fulfillTrainingData(route, visible.slice(body.offset ?? 0, (body.offset ?? 0) + (body.limit ?? 100)));
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await loginForHistory(page, 'client');
    await page.goto('/me/workouts');
    const currentToggle = page.getByRole('group', { name: 'Вид актуальных тренировок' });
    await expect(page.getByRole('tab', { name: 'Актуальное' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#workouts-current-panel .client-workout-card')).toHaveCount(13);
    await expect(page.locator('#workouts-current-panel .past-workout-plan-card')).toHaveCount(1);
    const currentBounds = await currentToggle.boundingBox();
    expect(currentBounds).not.toBeNull();
    expect(currentBounds!.y + currentBounds!.height).toBeLessThan(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('client-many-plans-390.png') });
    await currentToggle.getByRole('button', { name: 'Календарь' }).click();
    await expect(page.getByRole('grid', { name: 'Актуальные тренировки за Август 2026' })).toBeVisible();
    await page.getByRole('button', { name: 'Следующий месяц' }).click();
    await expect(page.getByText('В этом месяце актуальных тренировок нет.')).toBeVisible();
    await page.getByRole('button', { name: 'Следующий месяц' }).click();
    await page.getByRole('button', { name: '11 октября 2026 г., 1 тренировка' }).click();
    await expect(page.locator('.client-history-calendar-selection .client-workout-card')).toContainText('11 октября 2026 г.');
    await page.getByRole('tab', { name: 'История' }).click();
    const historyToggle = page.getByRole('group', { name: 'Вид истории тренировок' });
    const historyBounds = await historyToggle.boundingBox();
    expect(historyBounds).not.toBeNull();
    expect(Math.abs(historyBounds!.y - currentBounds!.y)).toBeLessThan(4);
    await expect(historyToggle.getByRole('button', { name: 'Список' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#workouts-history-panel .workout-chronicle-card')).toHaveCount(1);
    await historyToggle.getByRole('button', { name: 'Календарь' }).click();
    await expect(page.getByRole('grid', { name: 'История тренировок за Август 2026' })).toBeVisible();
    await page.getByRole('tab', { name: 'Актуальное' }).click();
    await expect(currentToggle.getByRole('button', { name: 'Календарь' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('grid', { name: 'Актуальные тренировки за Октябрь 2026' })).toBeVisible();
    await expect(page.locator('.client-history-calendar-day.selected')).toBeVisible();
    await page.getByRole('tab', { name: 'История' }).click();
    await expect(historyToggle.getByRole('button', { name: 'Календарь' })).toHaveAttribute('aria-pressed', 'true');
});
test('trainer: a plan stays visible through Live and completion from the client list', async ({ page }) => {
    const state = await mockNavigationWorkouts(page);
    state.status = 'planned';
    await loginForHistory(page, 'trainer');
    await page.goto(clientHistoryPath);
    await dismissCalendarHint(page);
    const upcoming = page.locator('.client-workout-card');
    await expect(upcoming).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Тренировка для клиента', exact: true })).toHaveCount(0);
    await upcoming.click();
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click();
    await expect(page).toHaveURL(`${detailPath}/live`);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(detailPath);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(clientHistoryPath);
    await expect(upcoming).toContainText('Идёт');
    await upcoming.click();
    await page.getByRole('link', { name: 'Продолжить тренировку' }).click();
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить проведение', exact: true }).click();
    await expect(page).toHaveURL(detailPath);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(clientHistoryPath);
    await expect(upcoming).toHaveCount(0);
    await expect(page.locator('.workout-chronicle-card')).toHaveCount(1);
});
test('trainer: upcoming loading and failure never masquerade as an empty list', async ({ page }) => {
    await mockNavigationWorkouts(page);
    await loginForHistory(page, 'trainer');
    let mode: 'loading' | 'error' | 'success' | 'empty' = 'loading';
    let release = () => { };
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/v1/training-data?*', async (route) => {
        const body = trainingPageParams(route);
        if (body.from === '2026-08-16' && !body.to) {
            expect(body.clientId).toBe(historyRow.clientId);
            if (mode === 'loading')
                await gate;
            if (mode === 'error') {
                await route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"22023","message":"Не удалось загрузить предстоящие тренировки"}' });
                return;
            }
            await fulfillTrainingData(route, mode === 'empty' ? [] : [workoutFixture({ ...historyRow, workoutDate: '2026-10-01', status: 'planned', exercises: [] })]);
            return;
        }
        await fulfillTrainingData(route, []);
    });
    await page.goto(clientHistoryPath);
    await expect(page.getByRole('status', { name: 'Загрузка', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Тренировка для клиента', exact: true })).toHaveCount(0);
    mode = 'error';
    release();
    await expect(page.getByText('Не удалось загрузить данные', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Тренировка для клиента', exact: true })).toHaveCount(0);
    mode = 'success';
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.locator('.client-workout-card')).toContainText('1 октября 2026 г.');
    await expect(page.getByRole('link', { name: 'Запланировать', exact: true })).toBeVisible();
    mode = 'empty';
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Тренировка для клиента', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Запланировать тренировку', exact: true })).toBeVisible();
});
for (const role of ['trainer', 'client'] as const) {
    test(`${role}: history list shows performed muscles and opens a copy from its own action`, async ({ page }, testInfo) => {
        await mockNavigationWorkouts(page);
        await loginForHistory(page, role);
        const path = role === 'trainer' ? clientHistoryPath : '/me/workouts?tab=history';
        await page.goto(path);
        await dismissCalendarHint(page);
        const card = page.locator('.workout-chronicle-card').first();
        const expectRoleContext = async () => {
            const muscles = card.getByLabel('Основные группы мышц: Кор · Ноги · Грудь · +1');
            if (role === 'trainer') {
                await expect(muscles).toHaveCount(0);
                await expect(card.locator('.workout-chronicle-brief')).toHaveText(`${fixtureExercise.name} · Присед · Жим лёжа · ещё 1`);
            }
            else
                await expect(muscles).toContainText('Мышцы: Кор · Ноги · Грудь · +1');
        };
        await expectRoleContext();
        const copy = card.getByRole('link', { name: /Скопировать тренировку за/ });
        await expect(copy).toHaveAttribute('href', `/workouts/new?copy=${historyRow.id}`);
        await expect(copy).toHaveCSS('width', '44px');
        await expect(copy).toHaveCSS('height', '44px');
        for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
            await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({ path: testInfo.outputPath(`${role}-history-actions-${width}.png`), fullPage: true });
        }
        await page.evaluate(() => window.localStorage.setItem('fit.appTheme', 'dark'));
        await page.reload();
        await expectRoleContext();
        if (role === 'client')
            await expect(card.getByLabel('Основные группы мышц: Кор · Ноги · Грудь · +1')).toBeVisible();
        for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
            await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({ path: testInfo.outputPath(`${role}-history-actions-dark-${width}.png`), fullPage: true });
        }
        await copy.click();
        await expect(page).toHaveURL(`/workouts/new?copy=${historyRow.id}`);
        await expect(page.getByText(fixtureExercise.name, { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Сохранить план' })).toBeVisible();
        await page.goto(path);
        await page.locator('.workout-chronicle-card').first().getByRole('link', { name: /Открыть тренировку за/ }).click();
        await expect(page).toHaveURL(detailPath);
    });
}
test('client: rest picker uses minute and second wheels and keeps overdue time visible', async ({ page }, testInfo) => {
    const state = await mockNavigationWorkouts(page);
    state.status = 'in_progress';
    state.setConfirmed = false;
    await loginForHistory(page, 'client');
    await page.goto(`${detailPath}/live`);
    await expect(page.getByRole('button', { name: 'Таймер отдыха', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Таймер отдыха', exact: true }).click({ button: 'right' });
    await expect(page.getByRole('listbox', { name: 'минуты' })).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'секунды' })).toBeVisible();
    await expect(page.getByRole('button', { name: '1:30' })).toBeVisible();
    for (const width of [390, 430]) {
        await page.setViewportSize({ width, height: 932 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`client-rest-picker-${width}.png`), fullPage: true });
    }
    await page.getByRole('option', { name: '00 минуты' }).click();
    await page.getByRole('option', { name: '01 секунды' }).click();
    await page.getByRole('button', { name: 'Начать отдых · 0:01' }).click();
    await page.clock.fastForward(2100);
    // Preparation is disabled: preserve the legacy negative rest countdown,
    // even when the exercise itself has a planned duration.
    const trigger = page.locator('.live-rest-trigger');
    await expect(trigger).toHaveClass(/rest-overdue/);
    await expect(trigger).toHaveText(/Отдых −0:01/);
    for (const width of [390, 430]) {
        await page.setViewportSize({ width, height: 932 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`client-rest-ended-${width}.png`), fullPage: true });
    }
});
test('client: unfinished Live workout reminds once after twenty minutes of inactivity', async ({ page }, testInfo) => {
    const state = await mockNavigationWorkouts(page);
    state.status = 'in_progress';
    state.setConfirmed = false;
    await loginForHistory(page, 'client');
    await page.goto(`${detailPath}/live`);
    await expect(page.getByRole('heading', { name: 'Live-тренировка' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('fit:workout-inactivity:')))).toBe(true);
    await page.clock.fastForward(20 * 60 * 1000);
    const reminder = page.getByRole('alert').filter({ hasText: 'Тренировка ещё идёт' });
    await expect(reminder).toBeVisible();
    await expect(reminder.getByRole('button', { name: 'Продолжить' })).toBeVisible();
    await expect(reminder.getByRole('button', { name: 'Завершить' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('client-inactivity-reminder-390.png') });
    await reminder.getByRole('button', { name: 'Завершить' }).click();
    await expect(reminder).toBeHidden();
    const finishConfirmation = page.locator('.finish-confirm');
    await expect(finishConfirmation).toContainText('Есть незавершённые подходы. Завершить частично?');
    await finishConfirmation.getByRole('button', { name: 'Отмена' }).click();
    await page.clock.fastForward(40 * 60 * 1000);
    await expect(reminder).toBeHidden();
});
for (const role of ['trainer', 'client'] as const) {
    test(`${role}: Live exercise removal confirms, recovers and persists on reload`, async ({ page }, testInfo) => {
        const state = await mockNavigationWorkouts(page);
        state.status = 'in_progress';
        let deleted = false;
        let fail = true;
        let calls = 0;
        await page.route('**/v1/training-data?*', route => fulfillTrainingData(route, [workoutFixture({ ...historyRow, status: state.status, version: state.version, trainerId, createdBy: trainerId, exercises: deleted ? [] : [{ ...fixtureExercise, sets: [fixtureSet] }] })]));
        await page.route('**/v1/workouts/*/exercises/*', async (route) => {
            calls += 1;
            expect(route.request().method()).toBe('DELETE')
            expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: state.version, operationId: expect.any(String) });
            if (fail) {
                fail = false;
                await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'workout_conflict' }) });
            }
            else {
                deleted = true;
                state.version += 1;
                await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workout: { version: state.version } }) });
            }
        });
        await loginForHistory(page, role);
        await page.goto(`${detailPath}/live`);
        await expect(page.locator('.live-timer')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.live-exercise-collapsed .exercise-thumbnail')).toHaveCount(1);
        await expect(page.locator('.live-exercise-collapsed .exercise-thumbnail video')).toHaveCount(0);
        await page.locator('.live-exercise-collapsed').click();
        await page.locator('.live-exercise').getByRole('button', { name: 'Ещё действия', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Удалить упражнение', exact: true }).click();
        const dialog = page.getByRole('alertdialog');
        await expect(dialog).toContainText('включая выполненные');
        for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
            await page.setViewportSize({ width, height: 932 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({ path: testInfo.outputPath(`${role}-delete-${width}.png`) });
        }
        await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
        expect(calls).toBe(0);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await page.locator('.live-exercise').getByRole('button', { name: 'Ещё действия', exact: true }).click();
            await page.getByRole('menuitem', { name: 'Удалить упражнение', exact: true }).click();
            await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
            if (attempt === 0)
                await expect(page.getByText(/Тренировка изменилась в другом окне/)).toBeVisible();
        }
        await expect(page.locator('.live-exercise')).toHaveCount(0);
        expect(calls).toBe(2);
        await page.reload();
        await expect(page.getByRole('button', { name: 'Выбрать упражнение', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Добавьте первое упражнение' })).toBeVisible();
        await expect(page.locator('.live-exercise, .live-exercise-collapsed')).toHaveCount(0);
    });
}
for (const role of ['trainer', 'client'] as const) {
    test(`${role}: completed exercise removal confirms, retries and persists on reload`, async ({ page }, testInfo) => {
        const state = await mockNavigationWorkouts(page);
        let deleted = false;
        let fail = true;
        let calls = 0;
        await page.route('**/v1/training-data?*', route => fulfillTrainingData(route, [workoutFixture({ ...historyRow, status: state.status, version: state.version, trainerId, createdBy: trainerId, exercises: deleted ? [] : [{ ...fixtureExercise, sets: [fixtureSet] }] })]));
        await page.route('**/v1/workouts/*/exercises/*', async (route) => {
            calls += 1;
            expect(route.request().method()).toBe('DELETE')
            expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: state.version, operationId: expect.any(String) });
            if (fail) {
                fail = false;
                await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'workout_conflict' }) });
            }
            else {
                deleted = true;
                state.version += 1;
                await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workout: { version: state.version } }) });
            }
        });
        await loginForHistory(page, role);
        await page.goto(detailPath);
        const actions = page.getByRole('button', { name: `Действия с упражнением «${fixtureExercise.name}»` });
        await expect(actions).toBeVisible();
        await actions.click();
        await page.getByRole('menuitem', { name: 'Удалить упражнение', exact: true }).click();
        const dialog = page.getByRole('alertdialog');
        await expect(dialog).toContainText('вместе со всеми подходами');
        await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
        const error = page.getByRole('alert').filter({ hasText: 'Не удалось удалить упражнение.' });
        await expect(error).toBeVisible();
        await error.getByRole('button', { name: 'Повторить', exact: true }).click();
        await expect(page.locator('.completed-exercise')).toHaveCount(0);
        expect(calls).toBe(2);
        for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
            await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({ path: testInfo.outputPath(`${role}-completed-delete-${width}.png`), fullPage: true });
        }
        await page.reload();
        await expect(page.locator('.completed-exercise')).toHaveCount(0);
    });
}
for (const role of ['trainer', 'client'] as const) {
    test(`${role}: calendar and list Back preserve the source without duplicate screens`, async ({ page }, testInfo) => {
        await mockNavigationWorkouts(page);
        await loginForHistory(page, role);
        const path = role === 'trainer' ? clientHistoryPath : '/me/workouts?tab=history';
        await page.goto(path);
        await dismissCalendarHint(page);
        await page.locator('.workout-chronicle-card').first().click();
        await expect(page).toHaveURL(detailPath);
        await page.getByRole('button', { name: 'Назад', exact: true }).click();
        await expect(page).toHaveURL(path);
        await page.locator('.workout-chronicle-card').first().click();
        await page.goBack();
        await expect(page).toHaveURL(path);
        await page.getByRole('button', { name: 'Календарь', exact: true }).click();
        await page.getByRole('button', { name: '10 августа 2026 г., 1 тренировка' }).click();
        const calendarUrl = page.url();
        const historyIndex = await page.evaluate(() => (window.history.state as {
            idx: number;
        }).idx);
        await page.locator('.client-history-calendar-selection .workout-chronicle-card').click();
        await page.getByRole('link', { name: /История упражнения/ }).click();
        await expect(page.getByRole('heading', { name: 'Упражнение', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Назад', exact: true }).click();
        await expect(page).toHaveURL(detailPath);
        await page.getByRole('button', { name: 'Назад', exact: true }).click();
        await expect(page).toHaveURL(calendarUrl);
        expect(await page.evaluate(() => (window.history.state as {
            idx: number;
        }).idx)).toBe(historyIndex);
        await expect(page.locator('.client-history-calendar-day.selected')).toBeVisible();
        await page.reload();
        await expect(page.locator('.client-history-calendar-day.selected')).toBeVisible();
        for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
            await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({ path: testInfo.outputPath(`${role}-calendar-${width}.png`), fullPage: true });
        }
        await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
        await expect(page.getByText('В этом месяце тренировок нет.')).toBeVisible();
        await page.getByRole('button', { name: 'Следующий месяц' }).click();
        await expect(page.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
        await page.goto(role === 'trainer' ? '/profile/settings' : '/me/settings');
        await page.getByRole('switch', { name: 'Тёмная тема' }).click();
        await page.goto(calendarUrl);
        await expect(page.locator('.client-history-calendar-day.selected')).toBeVisible();
        for (const width of [390, 430, ...(role === 'trainer' ? [1440] : [])]) {
            await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({ path: testInfo.outputPath(`${role}-calendar-dark-${width}.png`), fullPage: true });
        }
    });
}
test('trainer: editing, copy and deletion do not reopen a submitted form', async ({ page }) => {
    await mockNavigationWorkouts(page);
    await loginForHistory(page, 'trainer');
    await page.goto(`${clientHistoryPath}?view=calendar&month=2026-08&date=2026-08-10`);
    await dismissCalendarHint(page);
    const source = page.url();
    await page.locator('.workout-chronicle-card').click();
    await page.getByRole('link', { name: 'Изменить результат' }).click();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(detailPath);
    await page.getByRole('link', { name: 'Изменить результат' }).click();
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await expect(page).toHaveURL(detailPath);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(source);
    await page.locator('.workout-chronicle-card').click();
    await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click();
    await page.getByRole('menuitem', { name: 'Копировать тренировку' }).click();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page).toHaveURL(detailPath);
    await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click();
    await page.getByRole('menuitem', { name: 'Копировать тренировку' }).click();
    await page.getByRole('button', { name: 'Сохранить план' }).click();
    await expect(page).toHaveURL('/workouts/c1000000-0000-4000-8000-000000000002');
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(detailPath);
    await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click();
    await page.getByRole('menuitem', { name: 'Удалить тренировку' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page).toHaveURL(source);
});
test('trainer: Live completion returns to the original detail, then its source', async ({ page }) => {
    const state = await mockNavigationWorkouts(page);
    state.status = 'planned';
    await loginForHistory(page, 'trainer');
    await page.goto('/schedule?date=2026-08-16');
    await page.locator(`a[href="${detailPath}"]`).first().click();
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click();
    await expect(page).toHaveURL(`${detailPath}/live`);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(detailPath);
    await page.getByRole('link', { name: 'Продолжить тренировку' }).click();
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить проведение', exact: true }).click();
    await expect(page).toHaveURL(detailPath);
    await expect(page.getByRole('region', { name: 'Тренировка завершена' })).toBeVisible();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL('/schedule?date=2026-08-16');
});
test('trainer: direct detail link falls back to this client history', async ({ page }) => {
    await mockNavigationWorkouts(page);
    await loginForHistory(page, 'trainer');
    // New tab keeps authentication but has no preceding in-app route.
    const direct = await page.context().newPage();
    // page.route mocks do not apply to the new tab.
    await mockNavigationWorkouts(direct);
    await direct.goto(detailPath);
    await expect(direct.locator('.workout-header-eyebrow')).toHaveText('Анна Смирнова');
    await expect(direct.locator('.workout-header-contract h2')).toBeVisible();
    await direct.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(direct).toHaveURL(clientHistoryPath);
    await direct.close();
});
test('trainer: calendar loading, retry, empty month and list pagination', async ({ page }) => {
    const state = await mockNavigationWorkouts(page);
    state.count = 22;
    state.delayMonth = true;
    await loginForHistory(page, 'trainer');
    await page.goto(clientHistoryPath);
    await dismissCalendarHint(page);
    await expect(page.locator('.workout-chronicle-card')).toHaveCount(20);
    await page.getByRole('button', { name: 'Показать ещё' }).click();
    await expect(page.locator('.workout-chronicle-card')).toHaveCount(22);
    await page.locator('.workout-chronicle-card').last().click();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page.locator('.workout-chronicle-card')).toHaveCount(22);
    state.monthError = true;
    await page.getByRole('button', { name: 'Календарь', exact: true }).click();
    await expect(page.getByText('Загружаем месяц…')).toBeVisible();
    await expect(page.getByText('Не удалось загрузить историю за месяц.')).toBeVisible({ timeout: 15000 });
    state.monthError = false;
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await page.getByRole('button', { name: '10 августа 2026 г., 22 тренировки' }).click();
    await expect(page.locator('.client-history-calendar-selection .workout-chronicle-card')).toHaveCount(22);
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await expect(page.getByText('В этом месяце тренировок нет.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Список', exact: true })).toBeEnabled();
});
test('trainer: Today detail and direct Live keep Today as their source', async ({ page }) => {
    const state = await mockNavigationWorkouts(page);
    await loginForHistory(page, 'trainer');
    await page.reload();
    await page.locator(`a[href="${detailPath}"]`).first().click();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL('/today');
    state.status = 'in_progress';
    await page.reload();
    await page.locator(`a[href="${detailPath}/live"]`).first().click();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL('/today');
    await page.locator(`a[href="${detailPath}/live"]`).first().click();
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить проведение', exact: true }).click();
    await expect(page).toHaveURL(detailPath);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL('/today');
});
test('trainer: reload of finished Live does not pop past its detail', async ({ page }) => {
    const state = await mockNavigationWorkouts(page);
    state.status = 'planned';
    await loginForHistory(page, 'trainer');
    await page.goto('/schedule?date=2026-08-16');
    await page.locator(`a[href="${detailPath}"]`).first().click();
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click();
    await expect(page).toHaveURL(`${detailPath}/live`);
    await expect.poll(() => state.status).toBe('in_progress');
    // Let the start mutation and Live query settle before simulating an external finish.
    await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
    state.status = 'done';
    await page.reload();
    await expect(page).toHaveURL(detailPath);
    await expect(page.locator('.completed-exercise-list')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Изменить результат', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL('/schedule?date=2026-08-16');
});
