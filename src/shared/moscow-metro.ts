// Версия: 2026-09-15. Метро без МЦК, МЦД и закрытой Каховской линии.
// Станции сверены с публичным справочником HH и официальной схемой Московского транспорта.

export interface MoscowMetroLine {
  code: string
  name: string
  color: string
}

export interface MoscowMetroStation {
  id: string
  name: string
  lines: readonly MoscowMetroLine[]
}

export const MOSCOW_METRO_STATIONS = [
  {
    "id": "msk-aviamotornaya",
    "name": "Авиамоторная",
    "lines": [
      {
        "code": "8",
        "name": "Калининская",
        "color": "#FFCD1C"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      },
      {
        "code": "15",
        "name": "Некрасовская",
        "color": "#CC0066"
      }
    ]
  },
  {
    "id": "msk-avtozavodskaya",
    "name": "Автозаводская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-akademicheskaya",
    "name": "Академическая",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      },
      {
        "code": "16",
        "name": "Троицкая",
        "color": "#03795F"
      }
    ]
  },
  {
    "id": "msk-aleksandrovskiy-sad",
    "name": "Александровский сад",
    "lines": [
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      }
    ]
  },
  {
    "id": "msk-alekseevskaya",
    "name": "Алексеевская",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-alma-atinskaya",
    "name": "Алма-Атинская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-altufevo",
    "name": "Алтуфьево",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-aminevskaya",
    "name": "Аминьевская",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-annino",
    "name": "Аннино",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-arbatskaya",
    "name": "Арбатская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      },
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      }
    ]
  },
  {
    "id": "msk-aeroport",
    "name": "Аэропорт",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-aeroport-vnukovo",
    "name": "Аэропорт Внуково",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-babushkinskaya",
    "name": "Бабушкинская",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-bagrationovskaya",
    "name": "Багратионовская",
    "lines": [
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      }
    ]
  },
  {
    "id": "msk-barrikadnaya",
    "name": "Баррикадная",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-baumanskaya",
    "name": "Бауманская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-begovaya",
    "name": "Беговая",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-belomorskaya",
    "name": "Беломорская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-belorusskaya",
    "name": "Белорусская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      },
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-belyaevo",
    "name": "Беляево",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-bibirevo",
    "name": "Бибирево",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-biblioteka-im-lenina",
    "name": "Библиотека им.Ленина",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-bittsevskiy-park",
    "name": "Битцевский Парк",
    "lines": [
      {
        "code": "12",
        "name": "Бутовская",
        "color": "#BAC8E8"
      }
    ]
  },
  {
    "id": "msk-borisovo",
    "name": "Борисово",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-borovitskaya",
    "name": "Боровицкая",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-borovskoe-shosse",
    "name": "Боровское шоссе",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-botanicheskiy-sad",
    "name": "Ботанический сад",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-bratislavskaya",
    "name": "Братиславская",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-bulvar-admirala-ushakova",
    "name": "Бульвар Адмирала Ушакова",
    "lines": [
      {
        "code": "12",
        "name": "Бутовская",
        "color": "#BAC8E8"
      }
    ]
  },
  {
    "id": "msk-bulvar-generala-karbysheva",
    "name": "Бульвар Генерала Карбышева",
    "lines": [
      {
        "code": "17",
        "name": "Рублёво-Архангельская",
        "color": "#646464"
      }
    ]
  },
  {
    "id": "msk-bulvar-dmitriya-donskogo",
    "name": "Бульвар Дмитрия Донского",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-bulvar-rokossovskogo",
    "name": "Бульвар Рокоссовского",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-buninskaya-alleya",
    "name": "Бунинская аллея",
    "lines": [
      {
        "code": "12",
        "name": "Бутовская",
        "color": "#BAC8E8"
      }
    ]
  },
  {
    "id": "msk-butyrskaya",
    "name": "Бутырская",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-vdnh",
    "name": "ВДНХ",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-vavilovskaya",
    "name": "Вавиловская",
    "lines": [
      {
        "code": "16",
        "name": "Троицкая",
        "color": "#03795F"
      }
    ]
  },
  {
    "id": "msk-varshavskaya",
    "name": "Варшавская",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-verhnie-lihobory",
    "name": "Верхние Лихоборы",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-vladykino",
    "name": "Владыкино",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-vodnyy-stadion",
    "name": "Водный стадион",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-voykovskaya",
    "name": "Войковская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-volgogradskiy-prospekt",
    "name": "Волгоградский проспект",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-volzhskaya",
    "name": "Волжская",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-volokolamskaya",
    "name": "Волоколамская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-vorobevy-gory",
    "name": "Воробьевы горы",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-vorontsovskaya",
    "name": "Воронцовская",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-vyhino",
    "name": "Выхино",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-generala-tyuleneva",
    "name": "Генерала Тюленева",
    "lines": [
      {
        "code": "16",
        "name": "Троицкая",
        "color": "#03795F"
      }
    ]
  },
  {
    "id": "msk-govorovo",
    "name": "Говорово",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-davydkovo",
    "name": "Давыдково",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-delovoy-tsentr",
    "name": "Деловой центр",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      },
      {
        "code": "17",
        "name": "Рублёво-Архангельская",
        "color": "#646464"
      }
    ]
  },
  {
    "id": "msk-delovoy-tsentr-vystavochnaya",
    "name": "Деловой центр (Выставочная)",
    "lines": [
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      }
    ]
  },
  {
    "id": "msk-dinamo",
    "name": "Динамо",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-dmitrovskaya",
    "name": "Дмитровская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-dobryninskaya",
    "name": "Добрынинская",
    "lines": [
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-domodedovskaya",
    "name": "Домодедовская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-dostoevskaya",
    "name": "Достоевская",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-dubrovka",
    "name": "Дубровка",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-zhulebino",
    "name": "Жулебино",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-zil",
    "name": "ЗИЛ",
    "lines": [
      {
        "code": "16",
        "name": "Троицкая",
        "color": "#03795F"
      }
    ]
  },
  {
    "id": "msk-zvenigorodskaya",
    "name": "Звенигородская",
    "lines": [
      {
        "code": "17",
        "name": "Рублёво-Архангельская",
        "color": "#646464"
      }
    ]
  },
  {
    "id": "msk-zyuzino",
    "name": "Зюзино",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-zyablikovo",
    "name": "Зябликово",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-izmaylovskaya",
    "name": "Измайловская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-kaluzhskaya",
    "name": "Калужская",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-kantemirovskaya",
    "name": "Кантемировская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-kahovskaya",
    "name": "Каховская",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-kashirskaya",
    "name": "Каширская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-kievskaya",
    "name": "Киевская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      },
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      },
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-kitay-gorod",
    "name": "Китай-город",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      },
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-klenovyy-bulvar",
    "name": "Кленовый бульвар",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-kozhuhovskaya",
    "name": "Кожуховская",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-kolomenskaya",
    "name": "Коломенская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-kommunarka",
    "name": "Коммунарка",
    "lines": [
      {
        "code": "16",
        "name": "Троицкая",
        "color": "#03795F"
      }
    ]
  },
  {
    "id": "msk-komsomolskaya",
    "name": "Комсомольская",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      },
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-konkovo",
    "name": "Коньково",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-kornilovskaya",
    "name": "Корниловская",
    "lines": [
      {
        "code": "16",
        "name": "Троицкая",
        "color": "#03795F"
      }
    ]
  },
  {
    "id": "msk-kosino",
    "name": "Косино",
    "lines": [
      {
        "code": "15",
        "name": "Некрасовская",
        "color": "#CC0066"
      }
    ]
  },
  {
    "id": "msk-kotelniki",
    "name": "Котельники",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-krasnogvardeyskaya",
    "name": "Красногвардейская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-krasnopresnenskaya",
    "name": "Краснопресненская",
    "lines": [
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-krasnoselskaya",
    "name": "Красносельская",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-krasnye-vorota",
    "name": "Красные ворота",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-krestyanskaya-zastava",
    "name": "Крестьянская застава",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-kropotkinskaya",
    "name": "Кропоткинская",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-krylatskoe",
    "name": "Крылатское",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-krymskaya",
    "name": "Крымская",
    "lines": [
      {
        "code": "16",
        "name": "Троицкая",
        "color": "#03795F"
      }
    ]
  },
  {
    "id": "msk-kuznetskiy-most",
    "name": "Кузнецкий мост",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-kuzminki",
    "name": "Кузьминки",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-kuntsevskaya",
    "name": "Кунцевская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      },
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-kurskaya",
    "name": "Курская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      },
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-kutuzovskaya",
    "name": "Кутузовская",
    "lines": [
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      }
    ]
  },
  {
    "id": "msk-leninskiy-prospekt",
    "name": "Ленинский проспект",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-lermontovskiy-prospekt",
    "name": "Лермонтовский проспект",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-lesoparkovaya",
    "name": "Лесопарковая",
    "lines": [
      {
        "code": "12",
        "name": "Бутовская",
        "color": "#BAC8E8"
      }
    ]
  },
  {
    "id": "msk-lefortovo",
    "name": "Лефортово",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      },
      {
        "code": "15",
        "name": "Некрасовская",
        "color": "#CC0066"
      }
    ]
  },
  {
    "id": "msk-lianozovo",
    "name": "Лианозово",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-lomonosovskiy-prospekt",
    "name": "Ломоносовский проспект",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-lubyanka",
    "name": "Лубянка",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-luhmanovskaya",
    "name": "Лухмановская",
    "lines": [
      {
        "code": "15",
        "name": "Некрасовская",
        "color": "#CC0066"
      }
    ]
  },
  {
    "id": "msk-lyublino",
    "name": "Люблино",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-marksistskaya",
    "name": "Марксистская",
    "lines": [
      {
        "code": "8",
        "name": "Калининская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-marina-roscha",
    "name": "Марьина Роща",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-marino",
    "name": "Марьино",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-mayakovskaya",
    "name": "Маяковская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-medvedkovo",
    "name": "Медведково",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-mendeleevskaya",
    "name": "Менделеевская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-minskaya",
    "name": "Минская",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-mitino",
    "name": "Митино",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-michurinskiy-prospekt",
    "name": "Мичуринский проспект",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-mnevniki",
    "name": "Мнёвники",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-molodezhnaya",
    "name": "Молодежная",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-moskva-siti",
    "name": "Москва-Сити",
    "lines": [
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      }
    ]
  },
  {
    "id": "msk-myakinino",
    "name": "Мякинино",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-nagatinskaya",
    "name": "Нагатинская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-nagatinskiy-zaton",
    "name": "Нагатинский Затон",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-nagornaya",
    "name": "Нагорная",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-narodnoe-opolchenie",
    "name": "Народное Ополчение",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      },
      {
        "code": "17",
        "name": "Рублёво-Архангельская",
        "color": "#646464"
      }
    ]
  },
  {
    "id": "msk-nahimovskiy-prospekt",
    "name": "Нахимовский проспект",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-nekrasovka",
    "name": "Некрасовка",
    "lines": [
      {
        "code": "15",
        "name": "Некрасовская",
        "color": "#CC0066"
      }
    ]
  },
  {
    "id": "msk-nizhegorodskaya",
    "name": "Нижегородская",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      },
      {
        "code": "15",
        "name": "Некрасовская",
        "color": "#CC0066"
      }
    ]
  },
  {
    "id": "msk-novatorskaya",
    "name": "Новаторская",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      },
      {
        "code": "16",
        "name": "Троицкая",
        "color": "#03795F"
      }
    ]
  },
  {
    "id": "msk-novogireevo",
    "name": "Новогиреево",
    "lines": [
      {
        "code": "8",
        "name": "Калининская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-novokosino",
    "name": "Новокосино",
    "lines": [
      {
        "code": "8",
        "name": "Калининская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-novokuznetskaya",
    "name": "Новокузнецкая",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-novomoskovskaya",
    "name": "Новомосковская",
    "lines": [
      {
        "code": "16",
        "name": "Троицкая",
        "color": "#03795F"
      }
    ]
  },
  {
    "id": "msk-novomoskovskaya-kommunarka",
    "name": "Новомосковская (Коммунарка)",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-novoperedelkino",
    "name": "Новопеределкино",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-novoslobodskaya",
    "name": "Новослободская",
    "lines": [
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-novoyasenevskaya",
    "name": "Новоясеневская",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-novye-cheremushki",
    "name": "Новые Черемушки",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-ozernaya",
    "name": "Озёрная",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-okruzhnaya",
    "name": "Окружная",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-okskaya",
    "name": "Окская",
    "lines": [
      {
        "code": "15",
        "name": "Некрасовская",
        "color": "#CC0066"
      }
    ]
  },
  {
    "id": "msk-oktyabrskaya",
    "name": "Октябрьская",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      },
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-oktyabrskoe-pole",
    "name": "Октябрьское поле",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-olhovaya",
    "name": "Ольховая",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-orehovo",
    "name": "Орехово",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-otradnoe",
    "name": "Отрадное",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-ohotnyy-ryad",
    "name": "Охотный ряд",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-paveletskaya",
    "name": "Павелецкая",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      },
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-park-pobedy",
    "name": "Парк Победы",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      },
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-park-kultury",
    "name": "Парк культуры",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      },
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-partizanskaya",
    "name": "Партизанская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-pervomayskaya",
    "name": "Первомайская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-perovo",
    "name": "Перово",
    "lines": [
      {
        "code": "8",
        "name": "Калининская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-petrovskiy-park",
    "name": "Петровский парк",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-petrovsko-razumovskaya",
    "name": "Петровско-Разумовская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      },
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-pechatniki",
    "name": "Печатники",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-pionerskaya",
    "name": "Пионерская",
    "lines": [
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      }
    ]
  },
  {
    "id": "msk-planernaya",
    "name": "Планерная",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-ploschad-ilicha",
    "name": "Площадь Ильича",
    "lines": [
      {
        "code": "8",
        "name": "Калининская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-ploschad-revolyutsii",
    "name": "Площадь Революции",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-polezhaevskaya",
    "name": "Полежаевская",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-polyanka",
    "name": "Полянка",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-potapovo",
    "name": "Потапово",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-prazhskaya",
    "name": "Пражская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-preobrazhenskaya-ploschad",
    "name": "Преображенская площадь",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-prokshino",
    "name": "Прокшино",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-proletarskaya",
    "name": "Пролетарская",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-prospekt-vernadskogo",
    "name": "Проспект Вернадского",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-prospekt-mira",
    "name": "Проспект Мира",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      },
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-profsoyuznaya",
    "name": "Профсоюзная",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-pushkinskaya",
    "name": "Пушкинская",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-pyhtino",
    "name": "Пыхтино",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-pyatnitskoe-shosse",
    "name": "Пятницкое шоссе",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-ramenki",
    "name": "Раменки",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-rasskazovka",
    "name": "Рассказовка",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-rechnoy-vokzal",
    "name": "Речной вокзал",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-rizhskaya",
    "name": "Рижская",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-rimskaya",
    "name": "Римская",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-rumyantsevo",
    "name": "Румянцево",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-ryazanskiy-prospekt",
    "name": "Рязанский проспект",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-savelovskaya",
    "name": "Савёловская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-salarevo",
    "name": "Саларьево",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-sviblovo",
    "name": "Свиблово",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-sevastopolskaya",
    "name": "Севастопольская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-seligerskaya",
    "name": "Селигерская",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-semenovskaya",
    "name": "Семеновская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-serpuhovskaya",
    "name": "Серпуховская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-slavyanskiy-bulvar",
    "name": "Славянский бульвар",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-smolenskaya",
    "name": "Смоленская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      },
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      }
    ]
  },
  {
    "id": "msk-sokol",
    "name": "Сокол",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-sokolniki",
    "name": "Сокольники",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-solntsevo",
    "name": "Солнцево",
    "lines": [
      {
        "code": "8А",
        "name": "Солнцевская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-spartak",
    "name": "Спартак",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-sportivnaya",
    "name": "Спортивная",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-sretenskiy-bulvar",
    "name": "Сретенский бульвар",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-stahanovskaya",
    "name": "Стахановская",
    "lines": [
      {
        "code": "15",
        "name": "Некрасовская",
        "color": "#CC0066"
      }
    ]
  },
  {
    "id": "msk-strogino",
    "name": "Строгино",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-studencheskaya",
    "name": "Студенческая",
    "lines": [
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      }
    ]
  },
  {
    "id": "msk-suharevskaya",
    "name": "Сухаревская",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-shodnenskaya",
    "name": "Сходненская",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-taganskaya",
    "name": "Таганская",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      },
      {
        "code": "5",
        "name": "Кольцевая",
        "color": "#915133"
      }
    ]
  },
  {
    "id": "msk-tverskaya",
    "name": "Тверская",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-teatralnaya",
    "name": "Театральная",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-tekstilschiki",
    "name": "Текстильщики",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-teplyy-stan",
    "name": "Теплый Стан",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-terehovo",
    "name": "Терехово",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-tehnopark",
    "name": "Технопарк",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-timiryazevskaya",
    "name": "Тимирязевская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-tretyakovskaya",
    "name": "Третьяковская",
    "lines": [
      {
        "code": "8",
        "name": "Калининская",
        "color": "#FFCD1C"
      },
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-troparevo",
    "name": "Тропарево",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-trubnaya",
    "name": "Трубная",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-tulskaya",
    "name": "Тульская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-turgenevskaya",
    "name": "Тургеневская",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-tushinskaya",
    "name": "Тушинская",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-tyutchevskaya",
    "name": "Тютчевская",
    "lines": [
      {
        "code": "16",
        "name": "Троицкая",
        "color": "#03795F"
      }
    ]
  },
  {
    "id": "msk-ulitsa-1905-goda",
    "name": "Улица 1905 года",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-ulitsa-akademika-yangelya",
    "name": "Улица Академика Янгеля",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-ulitsa-gorchakova",
    "name": "Улица Горчакова",
    "lines": [
      {
        "code": "12",
        "name": "Бутовская",
        "color": "#BAC8E8"
      }
    ]
  },
  {
    "id": "msk-ulitsa-dmitrievskogo",
    "name": "Улица Дмитриевского",
    "lines": [
      {
        "code": "15",
        "name": "Некрасовская",
        "color": "#CC0066"
      }
    ]
  },
  {
    "id": "msk-ulitsa-skobelevskaya",
    "name": "Улица Скобелевская",
    "lines": [
      {
        "code": "12",
        "name": "Бутовская",
        "color": "#BAC8E8"
      }
    ]
  },
  {
    "id": "msk-ulitsa-starokachalovskaya",
    "name": "Улица Старокачаловская",
    "lines": [
      {
        "code": "12",
        "name": "Бутовская",
        "color": "#BAC8E8"
      }
    ]
  },
  {
    "id": "msk-universitet",
    "name": "Университет",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-universitet-druzhby-narodov",
    "name": "Университет дружбы народов",
    "lines": [
      {
        "code": "16",
        "name": "Троицкая",
        "color": "#03795F"
      }
    ]
  },
  {
    "id": "msk-fizteh",
    "name": "Физтех",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-filatov-lug",
    "name": "Филатов луг",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-filevskiy-park",
    "name": "Филевский парк",
    "lines": [
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      }
    ]
  },
  {
    "id": "msk-fili",
    "name": "Фили",
    "lines": [
      {
        "code": "4",
        "name": "Филёвская",
        "color": "#1EBCEF"
      }
    ]
  },
  {
    "id": "msk-fonvizinskaya",
    "name": "Фонвизинская",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-frunzenskaya",
    "name": "Фрунзенская",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-hovrino",
    "name": "Ховрино",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-horoshevskaya",
    "name": "Хорошевская",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-tsska",
    "name": "ЦСКА",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      }
    ]
  },
  {
    "id": "msk-tsaritsyno",
    "name": "Царицыно",
    "lines": [
      {
        "code": "2",
        "name": "Замоскворецкая",
        "color": "#4FB04F"
      }
    ]
  },
  {
    "id": "msk-tsvetnoy-bulvar",
    "name": "Цветной бульвар",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-cherkizovskaya",
    "name": "Черкизовская",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-chertanovskaya",
    "name": "Чертановская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-chehovskaya",
    "name": "Чеховская",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-chistye-prudy",
    "name": "Чистые пруды",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-chkalovskaya",
    "name": "Чкаловская",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-shabolovskaya",
    "name": "Шаболовская",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-shelepiha",
    "name": "Шелепиха",
    "lines": [
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      },
      {
        "code": "17",
        "name": "Рублёво-Архангельская",
        "color": "#646464"
      }
    ]
  },
  {
    "id": "msk-shipilovskaya",
    "name": "Шипиловская",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  },
  {
    "id": "msk-shosse-entuziastov",
    "name": "Шоссе Энтузиастов",
    "lines": [
      {
        "code": "8",
        "name": "Калининская",
        "color": "#FFCD1C"
      }
    ]
  },
  {
    "id": "msk-schelkovskaya",
    "name": "Щелковская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      }
    ]
  },
  {
    "id": "msk-schukinskaya",
    "name": "Щукинская",
    "lines": [
      {
        "code": "7",
        "name": "Таганско-Краснопресненская",
        "color": "#943E90"
      }
    ]
  },
  {
    "id": "msk-elektrozavodskaya",
    "name": "Электрозаводская",
    "lines": [
      {
        "code": "3",
        "name": "Арбатско-Покровская",
        "color": "#0072BA"
      },
      {
        "code": "11",
        "name": "Большая кольцевая",
        "color": "#88CDCF"
      },
      {
        "code": "15",
        "name": "Некрасовская",
        "color": "#CC0066"
      }
    ]
  },
  {
    "id": "msk-yugo-vostochnaya",
    "name": "Юго-Восточная",
    "lines": [
      {
        "code": "15",
        "name": "Некрасовская",
        "color": "#CC0066"
      }
    ]
  },
  {
    "id": "msk-yugo-zapadnaya",
    "name": "Юго-Западная",
    "lines": [
      {
        "code": "1",
        "name": "Сокольническая",
        "color": "#E42313"
      }
    ]
  },
  {
    "id": "msk-yuzhnaya",
    "name": "Южная",
    "lines": [
      {
        "code": "9",
        "name": "Серпуховско-Тимирязевская",
        "color": "#ADACAC"
      }
    ]
  },
  {
    "id": "msk-yasenevo",
    "name": "Ясенево",
    "lines": [
      {
        "code": "6",
        "name": "Калужско-Рижская",
        "color": "#F07E24"
      }
    ]
  },
  {
    "id": "msk-yahromskaya",
    "name": "Яхромская",
    "lines": [
      {
        "code": "10",
        "name": "Люблинско-Дмитровская",
        "color": "#BED12C"
      }
    ]
  }
] as const satisfies readonly MoscowMetroStation[]

const byId = new Map<string, MoscowMetroStation>(MOSCOW_METRO_STATIONS.map((station) => [station.id, station]))

export function moscowMetroStationById(id: string): MoscowMetroStation | undefined {
  return byId.get(id)
}

export function normalizeMetroSearch(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е')
}

export function searchMoscowMetroStations(query: string): readonly MoscowMetroStation[] {
  const normalized = normalizeMetroSearch(query)
  if (!normalized) return MOSCOW_METRO_STATIONS
  return MOSCOW_METRO_STATIONS.filter((station) => {
    const haystack = [station.name, ...station.lines.flatMap((line) => [line.code, line.name])]
      .map(normalizeMetroSearch).join(' ')
    return haystack.includes(normalized)
  })
}
