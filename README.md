# Helios

Our project for the NASA Space Apps Challenge (MODIS and VIIRS hot spots). Made by Akhilesh Madhavan and Bhavishyaa Vignesh. CAD done on Blender.

Helios puts MODIS and VIIRS fire data on one map and one calendar, from 2000 to today. Pick a place to see how many fires were detected there and whether this month is worse than usual.

## Run it

1. Install Python 3.10 or newer.
2. Double-click `start.bat` (Windows), `start.command` (Mac) or run `./start.sh` (Linux).
3. The first time, enter your Google Cloud project ID (it has to be registered for Earth Engine) and sign in to Google.
4. The app opens at http://127.0.0.1:8000.

To skip the welcome screens while testing, add `?skip` to the address.

## Data

All of it comes from Google Earth Engine:

- MODIS fires (FIRMS), 2000 to today
- VIIRS fires (VNP14A1), 2012 to today
- Sentinel-5P sulfur dioxide
- Sentinel-2 burn scars

"Harmonized" uses VIIRS from 2012 on. Before that it uses MODIS multiplied by a number k, which is the ratio of VIIRS to MODIS fires in the years when both were flying. The map shows both satellites together: red is MODIS, yellow is VIIRS, orange is both.

## Put it online

The repo has a `render.yaml` for Render. Make an Earth Engine service account, then in Render set `EE_PROJECT` to your project ID and `EE_KEY_JSON` to the whole key file. Never commit the key.

## Folders

- `backend/` the Python server (FastAPI + Earth Engine)
- `frontend/` the web page
