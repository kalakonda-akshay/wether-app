# Skyline Weather: Live Weather Dashboard

Search any city and see its current temperature, conditions, humidity, wind and a 5-day forecast. Plain HTML, CSS and JavaScript. No build step, no API key.

Data comes from the free [Open-Meteo](https://open-meteo.com/) geocoding and forecast APIs.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `style.css` | Layout, weather icon colors, loading and error states, light/dark theme |
| `script.js` | Validation, fetch calls, rendering, storage |

## How to run

You need an internet connection, because the weather is fetched live.

**Simplest:** unzip, then double-click `index.html`.

**Local server (recommended):** open a terminal in the `weather-dashboard` folder and run:

```
python3 -m http.server 8000
```

Then open http://localhost:8000. With Node.js you can use `npx serve .` instead.

On first load it shows London. After that it reopens your most recent search.

## What to try

- Search for `Tokyo`, `New York` or `Sydney`.
- Click the °C / °F buttons. The numbers change instantly with no new request.
- Submit an empty box, a single letter, or `abc123`. You get a validation message and no request is sent.
- Search `Xyzqwk`. You get a "City not found" error.
- Turn off your internet and search. You get a connection error with a "Try again" button.
- Click a recent-search chip to reload that city.

## How it works

**Two requests per search, in order.**

1. Geocoding turns the city name into latitude and longitude.
2. The forecast API uses those coordinates to return current conditions and 5 days of daily data.

Both use `async/await`:

```js
var place = await geocode(check.value, controller.signal);
var weather = await getForecast(place.latitude, place.longitude, controller.signal);
```

**Error handling.** `fetchJson()` throws when the response is not OK. `search()` wraps the calls in `try/catch/finally`:

- `catch` picks the message: not found, timeout, service error or no connection
- `finally` always re-enables the Search button and clears the busy state

**Cancel and timeout.** An `AbortController` cancels the previous request if you search again, and a 10-second timer aborts a request that hangs.

**Validation.** `validate()` trims the input and checks length (2 to 60) and allowed characters (letters, spaces, `.`, `'`, `-`, including accented letters). It runs before any network call.

**Dynamic DOM injection.** `render()` builds every element with `createElement` and `textContent`, so city names from the API are never parsed as HTML. The weather icons are inline SVG built from a lookup table keyed by the weather code.

**Weather codes.** The API returns a WMO code (0 clear, 61 rain, 95 thunderstorm and so on). `describe()` maps the code to a label and an icon, and uses `is_day` to pick sun or moon.

**Temperature units.** Data arrives in Celsius. `toUnit()` converts to Fahrenheit when needed, so toggling units re-renders saved data without fetching again.

**Storage.** The unit choice and the last 5 searches are kept in `localStorage`.

## Notes

- Open-Meteo's free service is meant for non-commercial use.
- Times shown are the city's local time.
- Wind speed is in km/h.
