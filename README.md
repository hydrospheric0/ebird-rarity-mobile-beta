# eBird Rarity Mobile

## About the tool
This mobile-first version of eBird Rarity Mapper helps birders quickly explore notable eBird reports and county-level rarity patterns from phones.
It uses a static GitHub Pages frontend and a Cloudflare Worker API backend (same architecture as desktop).
The apps are hosted at:
- https://hydrospheric0.github.io/twitcher/
- https://hydrospheric0.github.io/twitcher-beta/

## Features
- Mobile-optimized map and controls for county rarity browsing
- County switching directly from map overlays and county picker
- Date-range and ABA rarity filtering
- Fast marker rendering for larger county result sets
- GitHub Pages deployment via pushit.sh

## How to use
1. Open the app in your mobile browser.
2. Tap **Use My Location** to load your county notables.
3. Adjust days-back and ABA filters.
4. Tap neighboring counties on the map (or use the county picker) to switch county context.
5. Tap map points for species/checklist details.

## Development

### Run locally
- `npm install`
- `VITE_API_BASE_URL="https://ebird-rarity-mapper.bartwickel.workers.dev" npm run dev`

Dev uses a `/worker` proxy to avoid CORS issues.

### Production build
- `VITE_API_BASE_URL="https://ebird-rarity-mapper.bartwickel.workers.dev" npm run build`

Production builds require `VITE_API_BASE_URL` (the build will fail without it) to prevent accidentally deploying against the wrong worker.

### Enrich Dutch species aliases (NL)
- Add/edit mappings in [scripts/nl-species-aliases.sample.csv](scripts/nl-species-aliases.sample.csv) using `english,dutch` columns.
- Preview changes:
	- `python3 scripts/enrich-species-aliases.py --mapping scripts/nl-species-aliases.sample.csv --dry-run`
- Apply changes to [src/data/species-reference.json](src/data/species-reference.json):
	- `python3 scripts/enrich-species-aliases.py --mapping scripts/nl-species-aliases.sample.csv`

The script writes aliases in `nl: <Dutch name>` format so the app can show local names in species detail.
When an English name is not found in the main species reference, the script stores it in
[src/data/species-local-names.json](src/data/species-local-names.json) so Dutch names still appear in detail view.

### Build NL species reference + rarity codes
- Add/edit mappings in [scripts/nl-species-reference.sample.csv](scripts/nl-species-reference.sample.csv) using:
	- `english,dutch,scientific,nl_rarity_code`
- Preview generated output stats:
	- `python3 scripts/build-nl-species-reference.py --mapping scripts/nl-species-reference.sample.csv --dry-run`
- Generate [src/data/nl-species-reference.json](src/data/nl-species-reference.json):
	- `python3 scripts/build-nl-species-reference.py --mapping scripts/nl-species-reference.sample.csv`

NL rarity codes are NL-specific and intentionally separate from ABA codes.

### Ingest eBird frequency datasets (MVP)
- Create/refresh per-region frequency JSON used by species detail charts:
	- `python3 scripts/ingest-ebird-frequency.py --input NL=/path/to/NL.tsv --input NL-ZH=/path/to/NL-ZH.tsv`
- Output files are written to:
	- [public/data/frequency/regions/NL.json](public/data/frequency/regions/NL.json)
	- [public/data/frequency/regions/NL-ZH.json](public/data/frequency/regions/NL-ZH.json)
- Schema reference:
	- [public/data/frequency/schema.json](public/data/frequency/schema.json)

Species detail attempts worker endpoint `GET /api/species_frequency` first and falls back to static JSON artifacts under `public/data/frequency/regions` when endpoint/API-key access is unavailable.

### Download barchart exports via headless browser (Playwright)
- Install dependency once:
	- `npm install`
- First-time login (interactive browser, saves session cookies):
	- `npm run download:barcharts:login`
- Regular headless download (NL + all NL provinces):
	- `npm run download:barcharts`

Downloads are saved into [TEMP](TEMP) as `ebird_<REGION>__<from>_<to>_<bmo>_<emo>_barchart.txt`.

Then ingest all current NL files from `TEMP`:
- `python3 scripts/ingest-ebird-frequency.py --input NL=TEMP/ebird_NL__1900_2026_1_12_barchart.txt --input NL-DR=TEMP/ebird_NL-DR__1900_2026_1_12_barchart.txt --input NL-FL=TEMP/ebird_NL-FL__1900_2026_1_12_barchart.txt --input NL-FR=TEMP/ebird_NL-FR__1900_2026_1_12_barchart.txt --input NL-GE=TEMP/ebird_NL-GE__1900_2026_1_12_barchart.txt --input NL-GR=TEMP/ebird_NL-GR__1900_2026_1_12_barchart.txt --input NL-LI=TEMP/ebird_NL-LI__1900_2026_1_12_barchart.txt --input NL-NB=TEMP/ebird_NL-NB__1900_2026_1_12_barchart.txt --input NL-NH=TEMP/ebird_NL-NH__1900_2026_1_12_barchart.txt --input NL-OV=TEMP/ebird_NL-OV__1900_2026_1_12_barchart.txt --input NL-UT=TEMP/ebird_NL-UT__1900_2026_1_12_barchart.txt --input NL-ZE=TEMP/ebird_NL-ZE__1900_2026_1_12_barchart.txt --input NL-ZH=TEMP/ebird_NL-ZH__1900_2026_1_12_barchart.txt`

## Support this project
If you find this tool useful, please consider supporting its development:

<a href="https://buymeacoffee.com/bartg">
	<img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="180" />
</a>
