# Kol'ko još imam para? 💶

Mobilna web aplikacija (PWA) s čistom AMOLED crnom temom za kreiranje budžeta, praćenje kategorija potrošnje, bilježenje troškova s datumom i vremenom te izračun uštede po razdobljima.

## Značajke (v4)
- **Potpuno prazno početno stanje**: Automatski čisti stare testne ključeve i kreće bez unaprijed unesenih budžeta.
- **Prikaz `Preostalo:` po kategoriji**: Unutar svake kategorije iznad *Potrošeno* prikazuje se preostali raspoloživi iznos za tu kategoriju.
- **Upravljanje i brisanje završenih razdoblja**: Prošla i završena razdoblja zaključana su za izmjenu troškova i kategorija, ali se u svakom trenutku mogu obrisati putem gumba *Obriši razdoblje* uz sigurnosnu potvrdu.
- **Optimizirano za Samsung Galaxy S26 Ultra**: Prilagođene dodirne kontrole (`44px`), polja unosa (`16px` bez automatskog zumiranja), podrška za `safe-area-inset` i čista crna pozadina (`#000000`).
- **Sigurna lokalna pohrana**: Podaci se spremaju u `localStorage` (`v5` + `backup`) uz `navigator.storage.persist()`.
