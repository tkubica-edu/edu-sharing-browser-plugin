// Faked answers of the metadata agent for the dev mode, loaded into the background worker beside config.js; the
// sidebar has its own fixtures for the services it calls itself. A real answer captured from the agent rather than
// invented, with the envelope (`processing`, `_origins`, `_source_text`) the panel reads besides the fields.

const EDU_SHARING_DEV_FIXTURES = {
  /** `GET /health` of the metadata agent. */
  agentHealth: { status: "healthy", version: "2.0.0" },

  /** `POST /generate` — one erschlossener Inhalt, whatever page was actually extracted. */
  agentGenerate: {
    "contextName": "default",
    "schemaVersion": "2.0.0",
    "metadataset": "learning_material.json",
    "metadataset_uri": "http://w3id.org/openeduhub/vocabs/contentTypes/learning_material",
    "language": "de",
    "exportedAt": "2026-08-12T14:09:45.737074+00:00",
    "cclom:title": "Dresden – Landeshauptstadt Sachsens mit reicher Kultur und bedeutender Wirtschaft",
    "cclom:general_description": "Der Artikel bietet eine umfassende Übersicht über die Stadt Dresden, die Landeshauptstadt Sachsens, mit Informationen zu ihrer Geschichte, Geographie, Wirtschaft und Kultur. Er beschreibt die Bedeutung Dresdens als politisches Zentrum, Bildungsstandort und wirtschaftliches Zentrum des Ballungsraumes sowie als international bekannte Kunst- und Kulturstadt mit zahlreichen historischen Bauwerken und Museen. Zudem werden die geographische Lage und die naturräumlichen Besonderheiten der Stadt dargestellt.",
    "cclom:general_keyword": [
      "Dresden",
      "Sachsen",
      "Landeshauptstadt",
      "Technische Universität Dresden",
      "Silicon Saxony",
      "Barocke Architektur",
      "Elbtal",
      "Weihnachtsmarkt"
    ],
    "ccm:wwwurl": "https://de.wikipedia.org/wiki/Dresden",
    "preview:url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Dresden_Stadtwappen.svg/1280px-Dresden_Stadtwappen.svg.png?utm_source=de.wikipedia.org&utm_campaign=index&utm_content=thumbnail",
    "cclom:general_language": "de",
    "ccm:educationalcontext": [
      "http://w3id.org/openeduhub/vocabs/educationalContext/hochschule"
    ],
    "ccm:taxonid": [
      "http://w3id.org/openeduhub/vocabs/discipline/720"
    ],
    "oeh:new_lrt": [
      "http://w3id.org/openeduhub/vocabs/new_lrt/b98c0c8c-5696-4537-82fa-dded7236081e"
    ],
    "ccm:price": "http://w3id.org/openeduhub/vocabs/price/no",
    "cm:author": [
      "Autoren der Wikimedia-Projekte"
    ],
    "ccm:oeh_publisher_combined": "Wikimedia Foundation, Inc.",
    "ccm:commonlicense_key": "CC BY-SA",
    "ccm:commonlicense_cc_version": "4.0",
    "schema:datePublished": "2002-04-03",
    "_origins": {
      "cclom:title": "ai",
      "cclom:general_description": "ai",
      "cclom:general_keyword": "ai",
      "ccm:wwwurl": "ai",
      "preview:url": "ai",
      "cclom:general_language": "ai",
      "ccm:oeh_extendedType": "user",
      "ccm:educationalcontext": "ai",
      "ccm:taxonid": "ai",
      "oeh:new_lrt": "ai",
      "ccm:educationalintendedenduserrole": "user",
      "oeh:didactic_method": "user",
      "oeh:format": "user",
      "oeh:time_required": "user",
      "ccm:educationaltypicalagerange_from": "user",
      "ccm:educationaltypicalagerange_to": "user",
      "oeh:prerequisites": "user",
      "ccm:oeh_competence_requirements": "user",
      "ccm:competence": "user",
      "ccm:oeh_competence_check": "user",
      "oeh:required_tools": "user",
      "oeh:assessment_type": "user",
      "oeh:offers_certificate": "user",
      "oeh:certificate_name": "user",
      "oeh:accessibility_features": "user",
      "oeh:accessibility_hazards": "user",
      "oeh:accessibility_conformance": "user",
      "ccm:price": "ai",
      "cm:author": "ai",
      "ccm:oeh_publisher_combined": "ai",
      "ccm:custom_license": "user",
      "ccm:commonlicense_key": "ai",
      "ccm:commonlicense_cc_version": "ai",
      "schema:datePublished": "ai",
      "ccm:fskRating": "user"
    },
    "_source_text": "=== GRUNDINFORMATIONEN ===\nURL: https://de.wikipedia.org/wiki/Dresden\nTitel: Dresden – Wikipedia\nCanonical URL: https://de.wikipedia.org/wiki/Dresden\n\n=== META-TAGS ===\nSprache: de\n\n=== OPEN GRAPH ===\nog:title: Dresden – Wikipedia\nog:type: website\n\n=== LIZENZ ===\nQuelle (link[rel=license]): https://creativecommons.org/licenses/by-sa/4.0/deed.de\n\n=== BILDER ===\nVorschaubild: https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Dresden_Stadtwappen.svg/1280px-Dresden_Stadtwappen.svg.png?utm_source=de.wikipedia.org&utm_campaign=index&utm_content=thumbnail\nHero-Bild: https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Panorama_Dresden.jpg/3840px-Panorama_Dresden.jpg?utm_source=de.wikipedia.org&utm_campaign=parser&utm_content=thumbnail\n\n=== SCHEMA.ORG JSON-LD ===\nSchema 1 (@type: Article):\n{\n  \"@context\": \"https://schema.org\",\n  \"@type\": \"Article\",\n  \"name\": \"Dresden\",\n  \"url\": \"https://de.wikipedia.org/wiki/Dresden\",\n  \"sameAs\": \"http://www.wikidata.org/entity/Q1731\",\n  \"mainEntity\": \"http://www.wikidata.org/entity/Q1731\",\n  \"author\": {\n    \"@type\": \"Organization\",\n    \"name\": \"Autoren der Wikimedia-Projekte\"\n  },\n  \"publisher\": {\n    \"@type\": \"Organization\",\n    \"name\": \"Wikimedia Foundation, Inc.\",\n    \"logo\": {\n      \"@type\": \"ImageObject\",\n      \"url\": \"https://www.wikimedia.org/static/images/wmf-hor-googpub.png\"\n    }\n  },\n  \"datePublished\": \"2002-04-03T04:42:40Z\",\n  \"image\": \"https://upload.wikimedia.org/wikipedia/commons/d/dc/Dresden_Stadtwappen.svg?utm_source=de.wikipedia.org&utm_campaign=index&utm_content=original\",\n  \"headline\": \"Landeshauptstadt des Freistaates Sachsen, Deutschland\"\n}\n\n=== HAUPTINHALT ===\nDresden\n153 Sprachen\nArtikel\nDiskussion\nLesen\nBearbeiten\nQuelltext bearbeiten\nVersionsgeschichte\nWerkzeuge\nErscheinungsbild Verbergen\nText\nKlein\nStandard\nGroß\nBreite\nStandard\nBreit\nFarbe (Beta)\nAutomatisch\nHell\nDunkel\n\t\nDer Titel dieses Artikels ist mehrdeutig. Weitere Bedeutungen sind unter Dresden (Begriffsklärung) aufgeführt.\nWappen\tDeutschlandkarte\n\t\n\nBasisdaten\nKoordinaten:\t♁51° 3′ N, 13° 44′ O\nKoordinaten: 51° 3′ N, 13° 44′ O |  | \n\nBundesland:\tSachsen\nHöhe:\t112 m ü. NHN\nFläche:\t328,48 km²\nEinwohner:\t562.764 (31. Dez. 2025)[1]\nBevölkerungsdichte:\t1713 Einwohner je km²\nPostleitzahlen:\t01001–01328, 01465\nVorwahlen:\t0351, 03528, 035201\nKfz-Kennzeichen:\tDD\nGemeindeschlüssel:\t14 6 12 000\nStadtgliederung:\t10 Stadtbezirke,\n9 Ortschaften\nAdresse der\nStadtverwaltung:\tDr.-Külz-Ring 19\n01067 Dresden\nWebsite:\twww.dresden.de\nOberbürgermeister:\tDirk Hilbert (FDP)\nLage der Stadt Dresden in Sachsen\n\nGroßes Stadtwappen (Vollwappen) von Dresden, besonders geläufig in den 1920er Jahren.\nCollage der Sehenswürdigkeiten: Frauenkirche, Residenzschloss, Semperoper, Militärhistorisches Museum, Zwinger, Nachtpanorama\n\nDresden (Ausspracheⓘ/?; obersorbisch Drježdźany; abgeleitet aus dem altsorbischen Drežďany für Sumpf- oder Auwaldbewohner) ist die Landeshauptstadt des Freistaates Sachsen. Mit rund 560.000 Einwohnern ist Dresden, nach Leipzig, die zweitgrößte sächsische Kommune und die zwölftgrößte Stadt Deutschlands.\n\nAls Sitz der Sächsischen Staatsregierung und des Sächsischen Landtags sowie zahlreicher Landesbehörden ist die Großstadt das politische Zentrum Sachsens. Außerdem sind bedeutende Bildungs- und Kultureinrichtungen des Freistaates hier konzentriert, darunter die renommierte Technische Universität und die Hochschulen für Technik und Wirtschaft, Bildende Künste und Musik Carl Maria von Weber. Die an der Elbe gelegene kreisfreie Stadt ist sowohl eines der sechs Oberzentren Sachsens als auch wirtschaftliches Zentrum des Ballungsraumes Dresden mit über 780.000 Einwohnern.[2] Wirtschaftlich bedeutend sind etwa die Informationstechnik und Nanoelektronik, weshalb es sich als Zentrum von „Silicon Saxony“ positioniert. Ebenfalls große Wertschöpfung im Raum Dresden erbringen die Branchen Pharmazie, Kosmetik, Maschinen-, Fahrzeug- und Anlagenbau, Lebensmittel, optische Industrie, Dienstleistungen, Handel sowie der Tourismus. Mit drei Autobahnen, zwei Fernbahnhöfen, einem Binnenhafen sowie dem Flughafen Dresden bildet Dresden außerdem einen wichtigen Verkehrsknotenpunkt.\n\nArchäologische Spuren auf dem späteren Stadtgebiet deuten auf eine Besiedlung schon in der Steinzeit hin. In erhaltenen Urkunden wurde Dresden 1206 erstmals erwähnt und entwickelte sich zur kurfürstlichen, später königlichen Residenz, 1918 bis 1933 sowie ab 1990 Hauptstadt des Freistaates Sachsen, in der DDR von 1952 bis 1990 Bezirkshauptstadt. Dresden ist Sitz des römisch-katholischen Bistums Dresden-Meißen und der Ev.-Luth. Landeskirche Sachsens.\n\nInternational bekannt ist Dresden als Kunst- und Kulturstadt mit zahlreichen bedeutenden Bauwerken, wie dem barocken Zwinger oder der Frauenkirche, herausragenden Museen, wie der Gemäldegalerie Alter Meister oder dem Grünen Gewölbe, berühmten Klangkörpern, wie der Sächsischen Staatskapelle oder dem Kreuzchor, und als Wirkungsstätte weithin bekannter Kulturschaffender, zum Beispiel Richard Wagner, Heinrich Schütz und Carl Maria von Weber. Die Dresdner Altstadt wurde in großen Teilen rekonstruiert und durch verschiedene architektonische Epochen geprägt, neben dem Zwinger und der Frauenkirche beispielsweise mit der Semperoper und der Hofkirche sowie dem Residenzschloss. Der 1434 begründete Striezelmarkt ist einer der ältesten (ältester mit einer Urkunde bestätigter Weihnachtsmarkt[3]) und bekanntesten Weihnachtsmärkte Deutschlands. Dresden wird auch Elbflorenz genannt, ursprünglich vor allem wegen seiner Kunstsammlungen; maßgeblich trug dazu sowohl seine barocke und mediterran geprägte Architektur als auch seine malerische und klimatisch begünstigte Lage im Elbtal bei.[4]\n\nGeographieBearbeitenQuelltext bearbeiten\nLage und FlächeBearbeitenQuelltext bearbeiten\nBlick von der Frauenkirche flussaufwärts\n\nDie Stadt liegt beiderseits der Elbe zu großen Teilen im Elbtalkessel, eingebettet zwischen den Ausläufern des Osterzgebirges, dem Steilabfall der Lausitzer Granitplatte und dem Elbsandsteingebirge am Übergang vom Nordostdeutschen Tiefland zu den östlichen Mittelgebirgen im Süden Ostdeutschlands.\n\nDas nördliche und nordöstliche Stadtgebiet gehört naturräumlich daher zum Westlausitzer Hügel- und Bergland (Dresdner Heide und Schönfelder Hochland). Im Süden kennzeichnen die Talausgänge der Erzgebirgsabflüsse und Hochlagen den Übergang zum Östlichen Erzgebirgsvorland (eingegrenzter als Dresdner Erzgebirgsvorland und Meißner Hochland bezeichnet). Die Dresdner Elbtalweitung ist eine Untereinheit des Sächsischen Elblands. Vom Bundesamt für Naturschutz wurde Dresden vollständig der naturräumlichen Großlandschaft „D19 Sächsisches Hü",
    "processing": {
      "success": true,
      "fields_extracted": 15,
      "fields_total": 34,
      "processing_time_ms": 5151,
      "llm_provider": "b-api-openai",
      "llm_model": "gpt-4.1-mini",
      "errors": [],
      "warnings": []
    }
  }
};

// Expose on the global scope for the service worker / background script.
if (typeof self !== "undefined") { self.EDU_SHARING_DEV_FIXTURES = EDU_SHARING_DEV_FIXTURES; }
