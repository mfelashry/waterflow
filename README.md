<div align="center">

# Water Flow

### Trace where water goes anywhere on Earth.

An interactive hydrology explorer built at **HopHacks**.  
Search any place on Earth, fly down from orbit, and analyze water movement using terrain, satellite imagery, hydrology, flood data, soil data, and AI-assisted research.

<br/>

<a href="https://waterflow-teal.vercel.app/">
  <img src="https://img.shields.io/badge/Live_Demo-Open-111111?style=for-the-badge&logo=vercel&logoColor=white" />
</a>
<a href="https://github.com/mfelashry/waterflow">
  <img src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white" />
</a>
<a href="https://devpost.com/software/waterflow-41mrqd">
  <img src="https://img.shields.io/badge/Devpost-Project-003E54?style=for-the-badge&logo=devpost&logoColor=white" />
</a>
<a href="mailto:mfelashry@outlook.com">
  <img src="https://img.shields.io/badge/Email-Contact-EA4335?style=for-the-badge&logo=gmail&logoColor=white" />
</a>

<br/>

<img src="https://img.shields.io/badge/HopHacks-2026_Winner-7C3AED?style=for-the-badge" />
<img src="https://img.shields.io/badge/SpaceXAI-Make_it_Legendary-0B3D91?style=for-the-badge" />
<img src="https://img.shields.io/badge/OPEF-Environmental_Intelligence-198754?style=for-the-badge" />

<br/><br/>

<img src="https://placehold.co/1100x620/0f172a/e2e8f0?text=Water+Flow+Demo" alt="Water Flow Demo" width="100%" />

</div>

---

## Why it’s cool

-  **Search anywhere on Earth**
-  **Fly from space to ground**
-  **Trace rivers, streams, and nearby flow paths**
-  **Use real terrain + live satellite imagery**
-  **Explore Marimo charts for rainfall, gauges, hydrology, and flood context**
-  **Ask Grok questions about the selected site**
-  **Generate case studies and downloadable reports**

---

## Quick stack

<p>
  <img height="34" src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" />
  <img height="34" src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img height="34" src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" />
  <img height="34" src="https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white" />
  <img height="34" src="https://img.shields.io/badge/MapLibre-396CB2?style=for-the-badge&logo=maplibre&logoColor=white" />
  <img height="34" src="https://img.shields.io/badge/Marimo-FF6B6B?style=for-the-badge&logo=python&logoColor=white" />
  <img height="34" src="https://img.shields.io/badge/Grok-xAI-111111?style=for-the-badge" />
  <img height="34" src="https://img.shields.io/badge/OpenStreetMap-7EBC6F?style=for-the-badge&logo=openstreetmap&logoColor=white" />
</p>

---

## How it works

<details>
<summary><strong> Main features</strong></summary>

<br/>

- **Ask Grok + research** for site interpretation and linked sources  
- **Marimo charts tab** for rainfall, gauge flow, hydrology, soil, and flood context  
- **Ground tab** for surface water inventory, USDA SSURGO soil / infiltration, and FEMA flood zones  
- **Topo + flood layers** using USGS topographic basemap and FEMA NFHL polygons  
- **City report** with Wikipedia/Wikidata + flood/soil/measurements  
- **Print / PDF export** from the report tab  
- **Hydrology cache** for faster revisits  
- **Mobile bottom sheet UI** for quick access on smaller screens  

</details>

<br/>

### App

```bash
npm install
npm run dev -- --hostname 127.0.0.1 --port 43173
```

Open:

```bash
http://127.0.0.1:43173
```

### Marimo charts

```bash
python3 -m pip install -r requirements-marimo.txt
WATERFLOW_ORIGIN=http://127.0.0.1:43173 npm run marimo
```

Or both together:

```bash
npm run dev:all
```

### Optional Grok support

```bash
cp .env.example .env.local
# set XAI_API_KEY
```

</details>

<details>
<summary><strong>🗂️ Data sources</strong></summary>

<br/>

Water Flow combines public and external geospatial sources including:

- **USGS NHD / NWIS / EPQS**
- **OpenStreetMap / Overpass**
- **Open-Meteo Archive**
- **USDA SSURGO**
- **FEMA NFHL**
- **Esri Imagery + Wayback**
- **NASA GIBS**
- **Wikipedia + Wikidata**
- **xAI / Grok**

</details>

---

## 🔗 Contributors

<table>
<tr>
<td align="center">

<a href="https://linkedin.com/in/melashry">
<img src="https://d112y698adiu2z.cloudfront.net/photos/production/user_photos/005/367/150/datas/profile.jpeg" width="120" alt="Mohamed Elashry"/>
<br/>
<b>Mohamed Elashry</b>
</a>

<br/>
<sub>Builder · Developer</sub>
<br/><br/>

<a href="https://linkedin.com/in/melashry">
<img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn"/>
</a>

</td>

<td align="center">

<a href="https://www.linkedin.com/in/hamzaelashry/">
<img src="https://avatars.githubusercontent.com/u/322954558?v=4" width="120" alt="Hamza Elashry"/>
<br/>
<b>Hamza Elashry</b>
</a>

<br/>
<sub>Builder · Developer</sub>
<br/><br/>

<a href="https://www.linkedin.com/in/hamzaelashry/">
<img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn"/>
</a>

</td>
</tr>
</table>

---

## Links

-  **Live Demo:** https://waterflow-teal.vercel.app/
- **Devpost:** https://devpost.com/software/waterflow-41mrqd
- **GitHub:** https://github.com/mfelashry/waterflow

---

<div align="center">

Built for **HopHacks 2026**  
Winner — **SpaceXAI: Make it Legendary**  
Winner — **OPEF: Environmental Intelligence Challenge**

</div>
