// Версия: 2026-09-24. Линии и станции сети сверены с официальной
// схемой и расписанием ГУП «Петербургский метрополитен» на 01.06.2026.
// Одноимённые пересадочные станции объединены в одну пользовательскую локацию.

import type { MoscowMetroLine } from './moscow-metro'

export type SaintPetersburgMetroLine = MoscowMetroLine

export interface SaintPetersburgMetroStation {
  id: string
  name: string
  lines: readonly SaintPetersburgMetroLine[]
}

const LINE_1 = { code: '1', name: 'Кировско-Выборгская', color: '#D6083B' } as const
const LINE_2 = { code: '2', name: 'Московско-Петроградская', color: '#0078C9' } as const
const LINE_3 = { code: '3', name: 'Невско-Василеостровская', color: '#009A49' } as const
const LINE_4 = { code: '4', name: 'Лахтинско-Правобережная', color: '#EA7125' } as const
const LINE_5 = { code: '5', name: 'Фрунзенско-Приморская', color: '#702785' } as const
const LINE_6 = { code: '6', name: 'Красносельско-Калининская', color: '#8D5B2D' } as const

export const SAINT_PETERSBURG_METRO_STATIONS = [
  { id: 'spb-avtovo', name: 'Автово', lines: [LINE_1] },
  { id: 'spb-admiralteyskaya', name: 'Адмиралтейская', lines: [LINE_5] },
  { id: 'spb-akademicheskaya', name: 'Академическая', lines: [LINE_1] },
  { id: 'spb-baltiyskaya', name: 'Балтийская', lines: [LINE_1] },
  { id: 'spb-begovaya', name: 'Беговая', lines: [LINE_3] },
  { id: 'spb-buharestskaya', name: 'Бухарестская', lines: [LINE_5] },
  { id: 'spb-vasileostrovskaya', name: 'Василеостровская', lines: [LINE_3] },
  { id: 'spb-vladimirskaya', name: 'Владимирская', lines: [LINE_1] },
  { id: 'spb-volkovskaya', name: 'Волковская', lines: [LINE_5] },
  { id: 'spb-vyborgskaya', name: 'Выборгская', lines: [LINE_1] },
  { id: 'spb-gorny-institut', name: 'Горный институт', lines: [LINE_4] },
  { id: 'spb-gorkovskaya', name: 'Горьковская', lines: [LINE_2] },
  { id: 'spb-gostiny-dvor', name: 'Гостиный двор', lines: [LINE_3] },
  { id: 'spb-grazhdanskiy-prospekt', name: 'Гражданский проспект', lines: [LINE_1] },
  { id: 'spb-devyatkino', name: 'Девяткино', lines: [LINE_1] },
  { id: 'spb-dostoevskaya', name: 'Достоевская', lines: [LINE_4] },
  { id: 'spb-dunayskaya', name: 'Дунайская', lines: [LINE_5] },
  { id: 'spb-elizarovskaya', name: 'Елизаровская', lines: [LINE_3] },
  { id: 'spb-zenit', name: 'Зенит', lines: [LINE_3] },
  { id: 'spb-zvenigorodskaya', name: 'Звенигородская', lines: [LINE_5] },
  { id: 'spb-zvezdnaya', name: 'Звездная', lines: [LINE_2] },
  { id: 'spb-kirovskiy-zavod', name: 'Кировский завод', lines: [LINE_1] },
  { id: 'spb-komendantskiy-prospekt', name: 'Комендантский проспект', lines: [LINE_5] },
  { id: 'spb-krestovskiy-ostrov', name: 'Крестовский остров', lines: [LINE_5] },
  { id: 'spb-kupchino', name: 'Купчино', lines: [LINE_2] },
  { id: 'spb-ladozhskaya', name: 'Ладожская', lines: [LINE_4] },
  { id: 'spb-leninskiy-prospekt', name: 'Ленинский проспект', lines: [LINE_1] },
  { id: 'spb-lesnaya', name: 'Лесная', lines: [LINE_1] },
  { id: 'spb-ligovskiy-prospekt', name: 'Лиговский проспект', lines: [LINE_4] },
  { id: 'spb-lomonosovskaya', name: 'Ломоносовская', lines: [LINE_3] },
  { id: 'spb-mayakovskaya', name: 'Маяковская', lines: [LINE_3] },
  { id: 'spb-mezhdunarodnaya', name: 'Международная', lines: [LINE_5] },
  { id: 'spb-moskovskaya', name: 'Московская', lines: [LINE_2] },
  { id: 'spb-moskovskie-vorota', name: 'Московские ворота', lines: [LINE_2] },
  { id: 'spb-narvskaya', name: 'Нарвская', lines: [LINE_1] },
  { id: 'spb-nevskiy-prospekt', name: 'Невский проспект', lines: [LINE_2] },
  { id: 'spb-novocherkasskaya', name: 'Новочеркасская', lines: [LINE_4] },
  { id: 'spb-obvodny-kanal', name: 'Обводный канал', lines: [LINE_5] },
  { id: 'spb-obuhovo', name: 'Обухово', lines: [LINE_3] },
  { id: 'spb-ozerki', name: 'Озерки', lines: [LINE_2] },
  { id: 'spb-park-pobedy', name: 'Парк Победы', lines: [LINE_2] },
  { id: 'spb-parnas', name: 'Парнас', lines: [LINE_2] },
  { id: 'spb-petrogradskaya', name: 'Петроградская', lines: [LINE_2] },
  { id: 'spb-pionerskaya', name: 'Пионерская', lines: [LINE_2] },
  { id: 'spb-ploschad-aleksandra-nevskogo', name: 'Площадь Александра Невского', lines: [LINE_3, LINE_4] },
  { id: 'spb-ploschad-vosstaniya', name: 'Площадь Восстания', lines: [LINE_1] },
  { id: 'spb-ploschad-lenina', name: 'Площадь Ленина', lines: [LINE_1] },
  { id: 'spb-ploschad-muzhestva', name: 'Площадь Мужества', lines: [LINE_1] },
  { id: 'spb-politehnicheskaya', name: 'Политехническая', lines: [LINE_1] },
  { id: 'spb-primorskaya', name: 'Приморская', lines: [LINE_3] },
  { id: 'spb-proletarskaya', name: 'Пролетарская', lines: [LINE_3] },
  { id: 'spb-prospekt-bolshevikov', name: 'Проспект Большевиков', lines: [LINE_4] },
  { id: 'spb-prospekt-veteranov', name: 'Проспект Ветеранов', lines: [LINE_1] },
  { id: 'spb-prospekt-prosvescheniya', name: 'Проспект Просвещения', lines: [LINE_2] },
  { id: 'spb-prospekt-slavy', name: 'Проспект Славы', lines: [LINE_5] },
  { id: 'spb-putilovskaya', name: 'Путиловская', lines: [LINE_6] },
  { id: 'spb-pushkinskaya', name: 'Пушкинская', lines: [LINE_1] },
  { id: 'spb-rybatskoe', name: 'Рыбацкое', lines: [LINE_3] },
  { id: 'spb-sadovaya', name: 'Садовая', lines: [LINE_5] },
  { id: 'spb-sennaya-ploschad', name: 'Сенная площадь', lines: [LINE_2] },
  { id: 'spb-spasskaya', name: 'Спасская', lines: [LINE_4] },
  { id: 'spb-sportivnaya', name: 'Спортивная', lines: [LINE_5] },
  { id: 'spb-staraya-derevnya', name: 'Старая деревня', lines: [LINE_5] },
  { id: 'spb-tehnologicheskiy-institut', name: 'Технологический институт', lines: [LINE_1, LINE_2] },
  { id: 'spb-udelnaya', name: 'Удельная', lines: [LINE_2] },
  { id: 'spb-ulitsa-dybenko', name: 'Улица Дыбенко', lines: [LINE_4] },
  { id: 'spb-frunzenskaya', name: 'Фрунзенская', lines: [LINE_2] },
  { id: 'spb-chkalovskaya', name: 'Чкаловская', lines: [LINE_5] },
  { id: 'spb-chernaya-rechka', name: 'Черная речка', lines: [LINE_2] },
  { id: 'spb-chernyshevskaya', name: 'Чернышевская', lines: [LINE_1] },
  { id: 'spb-shushary', name: 'Шушары', lines: [LINE_5] },
  { id: 'spb-elektrosila', name: 'Электросила', lines: [LINE_2] },
  { id: 'spb-yugo-zapadnaya', name: 'Юго-Западная', lines: [LINE_6] },
] as const satisfies readonly SaintPetersburgMetroStation[]

const byId = new Map<string, SaintPetersburgMetroStation>(SAINT_PETERSBURG_METRO_STATIONS.map((station) => [station.id, station]))

export function saintPetersburgMetroStationById(id: string): SaintPetersburgMetroStation | undefined {
  return byId.get(id)
}
