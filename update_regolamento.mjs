import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://ougxeheoaifcuetnmgrw.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91Z3hlaGVvYWlmY3VldG5tZ3J3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzIzMDgyMiwiZXhwIjoyMDg4ODA2ODIyfQ.JVpNt7UyXPqeBYcGyd3liBI8GGl7f6XO4lEe9k2W3HE'
);

const articoli = [
  {
    numero: '1',
    titolo: 'Quota',
    ordine: 1,
    testo: `1.1. La Quota è pari a 30€ e va pagata entro il 31/08 al tesoriere di lega che è l'ultimo dell'anno prima.

1.2. È possibile aggiungere alla quota una somma fino a 10€, dove ogni euro corrisponde a 2,5 mln da aggiungere al budget. Questa decisione va effettuata entro il 14/08 alle 23:59.

1.2.1. La somma totale di 10€ è spendibile in 2 anni, permettendo quindi un'aggiunta totale di 25 mln divisibili in 2 anni. Ad esempio, è possibile aggiungere 7€ un anno e il seguente anno sarà possibile aggiungere un massimo di 3€. La somma di 10€ viene resettata ogni due anni.

1.3. All'inizio di ogni campionato è prevista una quota di iscrizione al campionato pari a 30 mln. Questa cifra viene pagata automaticamente il 31/07 alle 23:59.`,
  },
  {
    numero: '2',
    titolo: 'Sito',
    ordine: 2,
    testo: `2.1. Oltre a Leghe, e al gruppo Whatsapp per le aste, tutto quello che serve è sul sito dedicato.

2.2. All'interno di questo sarà possibile visualizzare tutte le informazioni di cui chiunque può aver bisogno e tenere conto della propria Società. Si dovranno inoltre effettuare determinate operazioni:

• Dopo ogni giornata, attraverso il simulatore, calcolare i propri guadagni e salvarli sui movimenti.
• La prima partita del mese o in assenza di esse il primo del mese, ricordarsi di aggiungere gli introiti dello stadio; quando contro il rivale ricordarsi di segnarlo.`,
  },
  {
    numero: '3',
    titolo: 'Rosa',
    ordine: 3,
    testo: `3.1. La rosa è composta da un minimo di 2 portieri e di 23 giocatori di movimento.

3.1.1. Nel caso la rosa risulti di un numero inferiore a quelli descritti a [3.1] non si potrà schierare la formazione, avendo quindi alla giornata un punteggio pari a 0.

3.2. La rosa può essere ampliata fino a un numero di 27 giocatori totali aggiungendo 2 giocatori senza alcuna limitazione e fino a un numero di 30 con la limitazione che almeno 3 di questi siano Under-21 (28 giocatori 1 under-21, 29 giocatori 2 under-21 e 30 giocatori 3 under-21).

3.2.1. Nel caso la rosa abbia un numero di giocatori superiore a 30 o non sia conforme alla regola degli Under-21 (ad esempio 28 giocatori in rosa ma 0 Under-21) non sarà possibile schierare la formazione e il punteggio della giornata sarà pari a 0.

3.3. In nessun caso è possibile avere più di 5 giocatori della stessa squadra all'interno della propria rosa. Nel caso se ne abbiano di più non sarà possibile schierare la formazione e il punteggio della giornata sarà pari a 0.

3.4. Oltre ai 30 giocatori massimi in rosa è possibile avere fino a 2 giocatori nel vivaio. Questi giocatori devono essere under-23, con una quotazione ≤3 e con 0 presenze a voto in campionato. L'acquisto di questi giocatori è possibile solo dopo l'aggiornamento del listone in seguito alla chiusura del mercato estivo reale (01/09). La compravendita di giocatori del vivaio è possibile durante tutto l'anno senza seguire le scadenze del normale mercato dei giocatori della rosa.

3.4.1. Quando questi giocatori arrivano a 2 presenze a voto e/o salgono di almeno 2 di quotazione, si è obbligati a svincolarli o a promuoverli in rosa. Se la rosa attuale ha meno di 30 giocatori, è possibile promuoverli senza svincolare e/o cedere giocatori, altrimenti si è obbligati a liberare slot per fargli posto. Dopo la promozione in rosa di giocatori dal vivaio, bisogna comunque attenersi alle normali regole di costruzione della rosa [3.1 e 3.2].

3.4.2. Lo svincolo di un giocatore del vivaio non ha costo né fa guadagnare milioni, ogni svincolo è quindi un taglio a costo 0.

3.4.3. Finché questi giocatori restano nel vivaio non gravano sul salary cap. Il loro acquisto segue le normali logiche per l'acquisto di svincolati, ma deve essere comunicato nel messaggio di interessamento che l'acquisto di questo svincolato sarebbe per il vivaio.

3.4.4. Il costo di mantenimento del vivaio è fisso per tutti e pari a 4 mln annuali da pagare entro il 15/08 alle 23:59. Non ci si può sottrarre al pagamento nonostante non si stia utilizzando effettivamente il vivaio.`,
  },
  {
    numero: '4',
    titolo: 'Stipendi',
    ordine: 4,
    testo: `4.1. Il salary cap è impostato a 75 mln per ogni partecipante.

4.2. Lo stipendio di ogni giocatore è pari alla quotazione del giocatore divisa per 5.

4.3. Se la somma dei salari di tutti i giocatori e dell'allenatore supera i 75 mln, il Presidente della squadra sarà costretto a rientrare entro i parametri entro la prossima giornata, altrimenti sarà costretto a non mettere la formazione e avere 0 come punteggio.

4.3.1. La squadra ha inoltre il mercato in entrata bloccato e non potrà acquistare giocatori da altri presidenti fino a che non rientrerà nei limiti del salary cap.

4.3.2. Nei mesi di giugno e luglio il salary cap può essere mantenuto negativo senza penalità.

4.4. Il giorno 1 di ogni mese alle 00:01 vengono pagati automaticamente gli stipendi dei vari giocatori. La cifra da pagare è pari al totale dei salari dei vari giocatori alle 23:59 dell'ultimo giorno del mese precedente diviso 12.

4.5. Il 01/01 alle 08:00, dopo aver pagato gli stipendi di dicembre e aver ricevuto i soldi dello stadio, i valori degli stipendi di alcuni giocatori vengono aggiornati:

• I 5 giocatori che hanno subito un incremento maggiore in termini di quotazione, e quindi stipendio, richiederanno un rinnovo del contratto: il presidente è quindi costretto a migliorare il loro contratto ed ad alzare lo stipendio che viene pagato loro.
• Ai 5 giocatori che hanno subito un decremento maggiore in termini di quotazione, e quindi stipendio, è possibile rinnovare il contratto al ribasso entro il 05/01 alle ore 20:00 seguendo delle limitazioni:
  - Se il giocatore è Under-21, questo non è possibile da effettuare.
  - Se il giocatore ha tra 22 e 30 anni, è possibile ridurre lo stipendio, ma questo giocatore dovrà essere venduto o svincolato durante la successiva sessione estiva.
  - Se il giocatore ha 31 o più anni, è possibile ridurre il suo contratto senza alcuna penalità.

4.5.1. Nel caso di due o più giocatori con pari incremento o decremento è il presidente a decidere arbitrariamente a chi abbassare o alzare lo stipendio.

4.6. Il 01/06 alle 08:00, dopo il pagamento degli stipendi considerando le quotazioni al 31/05 alle 23:59, vengono aggiornati gli stipendi di ogni singolo giocatore in rosa.

4.7. Il 01/08 alle 08:00 vengono aggiornati nuovamente gli stipendi di ogni singolo giocatore con le quotazioni del nuovo listone.

4.8. Ogni giocatore, comprato dagli svincolati o da altri presidenti, entra in rosa con un contratto biennale. Alla fine di ogni stagione, lo stipendio aumenta automaticamente del 10% se il giocatore rimane nella stessa rosa. Alla fine del secondo anno, entro il 31/05 alle 23:59, si può decidere di:

• Rinnovare il contratto per altri due anni: in questo caso, lo stipendio viene aumentato del 20%.
• Non rinnovare: il giocatore diventa svincolato automaticamente il 01/06.

Alla fine del terzo anno consecutivo in rosa, se il giocatore viene nuovamente confermato, entra in vigore il Bonus Fedeltà per cui lo stipendio subisce una riduzione del 10% a partire dalla quarta stagione.

4.8.1. Per gli Under-21 non si hanno mai aumenti contrattuali percentuali. Ad esempio se un giocatore ha 18 anni nella stagione 25/26 ed è mantenuto in rosa nella stagione 26/27 e nella stagione 27/28, non si avranno mai aumenti contrattuali perché sarà sempre under-21. Nel caso invece in cui un giocatore abbia 20 anni nella stagione 25/26 e venga mantenuto in rosa per le stagioni 26/27 e 27/28, non si avrà un aumento contrattuale nella stagione 26/27 (in quanto sarà ancora under-21) ma lo si avrà regolarmente del 20% nella stagione 27/28 (in quanto sarà il terzo anno in rosa e non è più under-21).

4.9. I giocatori comprati dagli svincoli o da altri presidenti tra il 01/06 dell'anno corrente e il 31/05 dell'anno successivo raggiungono 1 anno di contratto (e il 10% aggiuntivo di salario) il 01/06 dell'anno successivo indipendentemente dalla data in cui vengono acquistati. Se uno svincolato è quindi acquistato, ad es., il 20/05/2026, 12 giorni dopo (1/06/2026) avrà il suo stipendio aumentato del 10% per l'intero anno successivo come se fosse stato acquistato a settembre dell'anno precedente (2025).`,
  },
  {
    numero: '5',
    titolo: 'Mercato',
    ordine: 5,
    testo: `5.1. Il mercato è aperto dal 01/06 alle 09:00 al 15/09 alle 24 e dal 01/01 alle 09:00 al 15/02 alle 24.

5.1.1. L'acquisto di calciatori al di fuori dei periodi di mercato è concesso ma il giocatore si trasferirà nella squadra che lo acquista nel primo giorno possibile della prossima sessione di mercato. Stessa cosa vale per i soldi che saranno trasferiti il primo giorno possibile della successiva sessione di mercato.

5.2. Durante il mercato sono possibili acquisti tramite milioni, prestiti con diritto, obbligo o secchi e clausole tra presidenti.

5.3. Durante una trattativa con un presidente, il limite massimo per rispondere a un messaggio con una richiesta di informazioni e/o con offerte è di 24 ore. Se non è pervenuta una risposta entro questo limite, entrano in gioco le seguenti penalità:

• 1 mln dopo 24 ore.
• 3 mln dopo 48 ore.
• 5 mln dopo 72 ore.
• Dopo 96 ore il presidente che ha chiesto informazioni e/o fatto un'offerta può decidere se aggiungere o meno quel giocatore alla sua squadra per un valore pari a ½ della quotazione.

In nessun caso queste penalità sono applicabili se è un presidente che offre un suo giocatore ad un'altra squadra.

5.4. Al fine di evitare plusvalenze fittizie, l'offerta minima di un presidente verso un altro giocatore deve essere almeno pari a ½ della Quotazione visibile nella pagina della Rosa.

5.5. Ogni giocatore ha una clausola rescissoria; questa è pari a 1,75 volte la Quotazione visibile nella pagina della rosa e può essere esercitata solo dopo che il presidente detentore del cartellino ha rifiutato o proposto una controfferta almeno due volte o se sono passate 48 ore dalla prima offerta. L'acquisto tramite clausola è possibile anche durante un periodo di non mercato e il giocatore si trasferirà alla squadra il primo giorno di mercato disponibile.

5.5.1. Durante il periodo di mercato con giornate attive, l'acquisto tramite clausola può essere effettuato solo dal fischio d'inizio della prima partita fino a martedì alle 23:59. In periodo di mercato senza partite non ci sono limitazioni a quando la clausola può essere attivata. In caso di periodo di mercato con turno infrasettimanale, dato che non ci saranno aste per svincolati, non è mai possibile acquistare un calciatore tramite clausola rescissoria.

5.5.2. Se un giocatore viene acquistato con la clausola rescissoria, al proprietario del giocatore entrano 3/4 del valore della clausola.

5.6. All'interno di una sola sessione di mercato un giocatore non può cambiare più di 3 squadre. L'essere svincolato è considerabile come squadra. Il vivaio non conta mai come squadra.

5.6.1. Alcuni esempi:
• Squadra 1 → Squadra 2 → Squadra 3
• Squadra 1 → Svincolato → Squadra 2 → Squadra 3
• Svincolato → Squadra 2 → Squadra 3
• Vivaio Squadra 1 → Squadra 1 → Squadra 2 → Squadra 3
• Vivaio Squadra 1 → Vivaio Squadra 2 → Squadra 2 → Squadra 3 → Squadra 4

5.7. Tutti i prestiti con possibilità di riscatto (diritto o obbligo) devono avere un possibile costo a bilancio per il ricevente in un intervallo tra il 50% e il 150% della quotazione del giocatore. Il valore minimo di un prestito secco è invece una cifra base (prestito oneroso) pari al 10% della quotazione del giocatore. Non sono mai possibili prestiti senza conguaglio economico.

5.8. Ogni prestito ha scadenze fisse al 01/01 o al 01/06. Sono possibili prestiti di 6 mesi, 12 mesi, 18 mesi e 24 mesi.

5.8.1. Entrambi i presidenti coinvolti in un prestito possono farlo terminare anticipatamente rispetto alla scadenza normale pagando un indennizzo all'altra parte in causa. Questa cifra è pari al 25% della quotazione reale aggiornata su Leghe Fantacalcio per chi ha ricevuto in prestito e pari al 50% per chi ha dato in prestito.

5.8.2. Questo è attivabile sempre durante l'anno. Nel caso venga attivato in un periodo di mercato il giocatore si trasferirà all'altra squadra dopo 7 giorni esatti mentre se viene attivato in un periodo senza mercato allora si trasferirà nel primo giorno di mercato disponibile.

5.9. Quando un giocatore passa da un presidente ad un altro, se la quotazione del giocatore è variata, il giocatore percepirà un nuovo stipendio calcolato sulla base della quotazione al momento dell'acquisto.

5.10. Se un presidente lo desidera, è possibile attivare un'asta per un suo giocatore seguendo queste due possibili modalità:

• A rialzo: Il giocatore viene messo sul mercato ad una valutazione pari a ½ della quotazione. Ogni presidente può offrire di acquistare il giocatore offrendo almeno 0,1 mln in più rispetto all'offerta base o alla precedente. Se dopo 2 ore dall'ultima offerta non ci sono più state altre offerte, allora il giocatore va automaticamente a quel presidente. Dalle 00 alle 8 non è possibile fare offerte e il tempo risulta congelato.
• A discesa: Il giocatore viene messo sul mercato con una valutazione pari alla quotazione. Il suo valore diminuisce di 0,25 mln ogni 30 minuti. Il primo Presidente che completa la transazione si aggiudica il giocatore. Quando scende ad un valore pari a ½ della quotazione, il giocatore non può più essere acquistato.`,
  },
  {
    numero: '6',
    titolo: 'Svincoli',
    ordine: 6,
    testo: `6.1. Gli svincoli possono essere effettuati dal 01/08 al 31/05 seguendo due modalità:

• Ordinario:
  - Quando si vuole, non ci sono limiti al numero di svincoli.
  - Devono essere pagate le mensilità dello stipendio dal momento dello svincolo fino al 01/06.
  - Bisogna pagare una penale pari a:
    · 0,5 mln se la quotazione è tra 1 e 10.
    · 1 mln tra 11 e 20.
    · 1,5 mln tra 21 e 30.
    · 2 mln oltre 31.

• Straordinario:
  - Sono 6 nel periodo estivo e 4 nel periodo invernale.
  - Viene rimborsato un indennizzo, questo è pari a ¼ della Quotazione indicata. Se il giocatore si è trasferito all'estero, l'indennizzo è pari a ½ della quotazione.
  - Oltre all'indennizzo vengono rese le mensilità pagate dal presidente fino al momento dello svincolo, partendo dalla mensilità di giugno pagata il 01/07.

6.2. I giocatori under-21 possono essere svincolati in due modalità:

• Conteggiati: Rientrano nel conteggio degli svincoli straordinari (6 e 4 in base al periodo) e rendono soldi seguendo la normale regola degli svincoli straordinari.
• Non Conteggiati: Sono svincoli a costo e guadagno 0, non sono limitati e non interferiscono con il conteggio degli svincoli straordinari.

6.3. Non è possibile svincolare un giocatore prima di 30 giorni dal suo acquisto da svincolato o da un altro presidente e non è possibile riacquistare un giocatore che hai svincolato prima di 60 giorni, anche se nel frattempo è stato acquistato da un altro presidente.

6.4. La base d'asta per l'acquisto di giocatori svincolati è pari a ¾ della quotazione del giocatore visibile nella pagina Svincolati. L'acquisto degli svincolati è possibile durante tutta la stagione e segue il seguente processo:

• La finestra di presentazione delle offerte si apre ogni martedì mattina alle 9:00 e dura fino a mercoledì alle 20:00.
• Il presidente interessato all'acquisto di un giocatore manifesta il suo interesse all'interno del gruppo Whatsapp. Gli altri presidenti interessati all'acquisto hanno tempo fino a giovedì alle 20:00 per manifestare il loro interesse.
• Il venerdì vengono effettuate le aste per i vari giocatori, con l'ultima asta che dovrebbe essere sempre prima della prima partita della giornata per permettere di schierare il giocatore svincolato dal presidente che lo acquista.
• I presidenti interessati possono accordarsi per spostare l'asta a un altro giorno che non sia il venerdì, ma il momento scelto per effettuare l'asta deve essere: o prima che il determinato giocatore possa scendere in campo, o almeno martedì dopo l'aggiornamento delle quotazioni.
• Se qualcuno dei presidenti ha problemi ad essere presente a un'asta decisa per un determinato orario, deve comunicarlo e verrà trovato un altro momento in cui farla. Se non lo fa o se dice che sarà presente e una sua offerta non è comunicata al battitore entro 10 minuti dopo la scadenza decisa, l'offerta sarà pari alla quotazione del giocatore svincolato.
• L'offerta massima per un giocatore svincolato è pari al bilancio del presidente in quel momento; non è mai possibile fare un'offerta per un giocatore più alta della liquidità disponibile. In caso di 2 o più offerte più alte di uguale valore (maggiore comunque rispetto all'offerta minima), il giocatore va al presidente che si è interessato prima al giocatore.
• In generale, non è possibile ritirarsi dall'interesse di comprare un giocatore. L'unica casistica in cui è consentito è un caso di infortunio o motivazioni speciali che devono comunque passare al vaglio degli admin.

6.4.1. L'unico periodo in cui l'acquisto di giocatori svincolati non è consentito è durante i turni infrasettimanali. In quelle settimane non si terranno aste e non si potranno dichiarare interessamenti.

6.5. Non è consentito lo svincolo di più di 14 giocatori in una singola stagione. Nel caso ciò avvenisse, si è costretti a pagare una penale di 2 mln aggiuntivi per ogni singolo giocatore svincolato oltre ai 14.`,
  },
  {
    numero: '7',
    titolo: 'Bilancio',
    ordine: 7,
    testo: `7.1. Per evitare l'accumulo eccessivo di crediti, ogni lunedì alle 23:59 dal 01/08 al 31/05 viene effettuato un controllo sul bilancio liquido (non sul valore della rosa). Se il bilancio supera le seguenti soglie, viene applicata una tassa settimanale:

• Bilancio 1–20 mln → 1% di tassazione.
• Bilancio 21–40 mln → 2% di tassazione.
• Bilancio 41–60 mln → 3% di tassazione.
• Bilancio 61–80 mln → 5% di tassazione.
• Bilancio 81–100 mln → 8% di tassazione.
• Bilancio sopra i 100 mln → 10% di tassazione.

7.1.1. La tassa viene sottratta automaticamente dal bilancio disponibile ogni domenica alle 23:00. Le soglie potranno essere riviste ogni stagione in base all'economia della lega.

7.1.2. Durante il periodo tra il 01/06 e lo 01/08 la tassazione è uguale per tutti e pari all'1%.

7.2. Se il budget risulta in negativo, si procede ad una penalizzazione in base a quanto è in negativo:

• Da 0 a -10 mln: dopo una settimana, 5 punti di penalizzazione nella stagione corrente.
• Da -10 a -20 mln: 10 punti di penalizzazione nella stagione corrente dopo una settimana.
• Da -20 a -30 mln: 15 punti di penalizzazione nella stagione corrente dopo una settimana.

7.2.1. Durante un periodo di mercato il bilancio deve essere negativo per due settimane prima di incorrere in una penalizzazione.

7.3. Alla chiusura di ogni finestra di mercato viene fatto un calcolo dal giorno di chiusura del mercato precedente a quel momento (2 calcoli ogni anno, uno nel periodo dal 16/02 al 15/09 e uno dal 16/09 al 15/02). La differenza tra tutte le uscite nei mesi e le entrate (esclusi guadagni di giornata e pagamenti di stipendi, mentre il rifinanziamento fatto in soldi veri è invece considerato) non può superare i 50 mln.

7.3.1. Se la differenza è:
• Fino a 50 → Nessuna penalità (zona "sicura").
• 50–55 → Multa di 10 mln.
• 55–60 → Multa di 15 mln + 2 punti di penalizzazione nella stagione corrente.
• >60 → Multa di 20 mln + 4 punti di penalizzazione nella stagione corrente + 5€ aggiuntivi.`,
  },
  {
    numero: '8',
    titolo: 'Guadagno Giornata',
    ordine: 8,
    testo: `8.1. I guadagni ad ogni giornata seguono la seguente tabella:

Gol Segnati → Milioni Guadagnati:
0 gol → 0 mln | 1 gol → 1 mln | 2 gol → 2 mln | 3 gol → 3 mln
4 gol → 4 mln | 5 gol → 5 mln | 6 gol → 6 mln | 7 gol → 7 mln

Gol Subiti → Milioni Guadagnati:
0 gol → +0,5 mln | 1 gol → -0,25 mln | 2 gol → -0,5 mln | 3 gol → -0,75 mln
4 gol → -1 mln | 5 gol → -1,25 mln | 6 gol → -1,5 mln | 7 gol → -1,75 mln

Guadagni stadio: 4 mln il primo di ogni mese.

Costi Giocatori (per giocatore che ha influenzato il punteggio finale):
• Assist: -0,1 mln
• Gol: -0,3 mln
• Porta Inviolata: -0,2 mln
• Rigore Parato: -0,5 mln
• MVP: -0,2 mln
• Ammonizione: +0,1 mln
• Espulsione: +0,3 mln
• Gol Subito: +0,1 mln
• Autorete: +0,5 mln
• Rigore Sbagliato: +0,5 mln

Risultato: Vittoria +0,5 mln | Pareggio +0,25 mln

8.2. Se la formazione non viene schierata, tutte le perdite risultano raddoppiate e tutti i guadagni azzerati. La partita è comunque giocata e può essere vinta recuperando l'ultima formazione di default. Il termine ultimo per schierare la formazione è 1 secondo prima del fischio d'inizio.

8.3. Tra la terza e la quarta giornata di campionato ogni squadra deve comunicare la propria squadra rivale. Ogni qualvolta questa squadra (5 volte all'interno di ogni campionato) viene affrontata, i guadagni di giornata cambiano:
• Vittoria → 1 mln
• Pareggio → 0,5 mln`,
  },
  {
    numero: '9',
    titolo: 'Obiettivi',
    ordine: 9,
    testo: `9.1. Gli obiettivi vengono scelti dai presidenti in ordine di arrivo in classifica al contrario:
• Ottavo: Entro 03/08 alle 15:00
• Settimo: Entro 04/08 alle 03:00
• Sesto: Entro 04/08 alle 15:00
• Quinto: Entro 05/08 alle 03:00
• Quarto: Entro 05/08 alle 15:00
• Terzo: Entro 06/08 alle 03:00
• Secondo: Entro 06/08 alle 15:00
• Primo: Entro 07/08 alle 03:00

9.1.1. La mancata comunicazione della scelta degli obiettivi comporterà uno scivolamento nella scelta a 12 ore dopo l'ultima scelta e -1 punto di penalizzazione nella stagione corrente.

9.1.2. Ogni carta ha un costo di 5 milioni da pagare al momento della scelta e l'apparato dirigenziale (Allenatore, DS e DG) ha un salario pari a 5 milioni che impatta in modo fisso sul salary cap.

9.2. Gli allenatori sono 11 carte specifiche (una per ogni modulo mantra) con 2 moduli prediletti. Ogni allenatore avrà 6 obiettivi: 3 generici, 2 su Mercato/Economia e 1 su Rosa/Giocatori. I DG e DS daranno soldi solo a fine campionato (31/05), gli altri al completamento.

9.2.1. Perché un obiettivo dell'allenatore venga conteggiato, la formazione schierata deve essere di uno dei due moduli dell'allenatore. Sommati insieme, questi due moduli vanno schierati complessivamente per almeno 27 partite, pena l'annullamento degli obiettivi.

9.3. Allenatori disponibili:
• Guardiola (3-5-1-1 / 3-4-2-1)
• Klopp (4-3-3 / 3-4-3)
• Luis Enrique (3-4-1-2 / 4-3-1-2)
• Conte (3-4-3 / 3-5-1-1)
• Capello (4-3-1-2 / 4-4-2)
• Mourinho (4-2-3-1 / 4-4-1-1)
• Allegri (3-5-2 / 3-4-1-2)
• Lippi (4-4-1-1 / 4-1-4-1)
• Sir Ferguson (4-4-2 / 3-5-2)
• Ancelotti (3-4-2-1 / 4-3-3)
• Sacchi (4-1-4-1 / 4-2-3-1)

9.4. Ogni obiettivo dell'allenatore fornisce 2 mln a bilancio e 1 mln aggiuntivo al salary cap; ogni obiettivo DS e DG fornisce 5 milioni l'uno. Ogni obiettivo DS o DG fallito comporta una penalità pari a 2 mln.`,
  },
  {
    numero: '10',
    titolo: 'Investimenti',
    ordine: 10,
    testo: `10.1. Il budget massimo di investimenti per stagione è pari a 30 mln e tutti gli investimenti vanno comunicati tra il 01/08 alle 09:00 e il 20/09 alle 23:59.

10.2. Investimenti Piccoli:
• Scouting Estero e Diritto di Prelazione (2 mln): Dal 01/09 al 20/09, seleziona 1 giocatore estero non nel listone. Se entro 2 anni solari quel giocatore viene inserito nel listone, hai il diritto esclusivo di tesserarlo pagando ½ della quotazione.
• Scommessa Rendimento (2 mln): Seleziona 2 giocatori della tua rosa. Se uno di questi migliora la quotazione di almeno 7 mln, ottieni 2,5 mln per ognuno dei giocatori migliorati.
• Avvocato (3 mln): Ogni 5 ammonizioni dei tuoi giocatori titolari o subentrati, guadagni 0,5 mln. Il doppio cartellino giallo conta come singolo.
• Vice Allenatore premium (5 mln): 3 volte durante la stagione puoi modificare un giocatore dopo il fischio d'inizio della giornata.
• Ricapitalizzazione (5 mln): Investi 5 mln per abbassare il tuo Fair play finanziario di 3 mln. Attivabile al massimo entro il 05/09.

10.3. Investimenti Medi:
• Settore Giovanile Avanzato (6 mln): Alza il limite del vivaio da 2 a 4 giocatori per l'anno seguente e il successivo.
• SuperClub (7 mln): Aumenta per la stagione il tuo Salary Cap di 3 mln.
• Accordi TV (8 mln): Ogni qualvolta segni almeno 2 gol in una partita, ottieni 0,5 mln extra.
• Clean Sheet (9 mln): +1,5 mln per ogni giornata in cui la tua squadra non subisce gol "fantacalcistici" (totale squadra avversaria < 66 punti).
• The MVP (9 mln): Ogni qualvolta un tuo giocatore titolare o subentrato prende l'MVP, ottieni 0,5 mln.

10.4. Investimenti Grandi:
• Ristrutturazione dello Stadio (10 mln): Dalla stagione successiva ogni mese ottieni 1,5 mln in più dallo stadio. Devono passare 3 anni per ripetere l'investimento.
• Branding Internazionale (10 mln): Fine anno 1°→20 mln, 2°→15 mln, 3°→12 mln, 4°→8 mln. Vittoria Coppa +5 mln. Finale persa +1 mln.
• Direttore Sportivo "Masterclass" (12 mln): Durante le aste svincolati, se sei il presidente che ha chiamato il giocatore, puoi conoscere l'offerta più alta avversaria prima di formalizzare la tua (2 volte in stagione). Devi offrire almeno 1 mln sopra l'ultima offerta.
• Centro Giovani e Selezione Under-21 (14 mln): Dalla stagione successiva puoi selezionare 1 Under-21 svincolato a stagione pagando ¼ della quotazione. Scelte effettuate in ordine di classifica precedente (dal primo all'ultimo).
• Abbonamenti Premium (15 mln): Vittoria in casa +1,5 mln (2 mln se con ≥2 gol di scarto), pareggio in casa +1 mln. Valido per 1 stagione.

10.5. Investimenti Invernali (attivabili dal 24/12 al 31/12, max 10 mln):
• Rientro in Grande (3 mln): Scegli un tuo giocatore infortunato. Nelle prime 5 giornate utili dal suo rientro, guadagni 1,2 mln per ogni partita in cui prende voto almeno 6.
• Deroga U-21 (4 mln): Puoi arrivare a 30 giocatori in rosa anche con 1 solo Under-21 fino al 01/06.
• Clausola Segreta (4 mln): Fino al 31/05, la clausola rescissoria dei tuoi giocatori aumenta da 1,75 a 2,0 volte la quotazione.
• Re del Girone di Ritorno (7 mln): Se nella seconda metà della stagione (dalla 19a giornata) ottieni almeno 8 punti in più rispetto alla prima metà, ricevi 10 mln a fine anno.
• Corso Analisi Video (10 mln): Puoi effettuare una sostituzione rispetto alla tua formazione originaria entro le 23:59 del giorno in cui si è giocata l'ultima partita della giornata. Attuabile una sola volta, non nelle ultime 5 giornate, in semifinale e finale di Coppa.`,
  },
  {
    numero: '11',
    titolo: 'Penalità',
    ordine: 11,
    testo: `11.1. Gli admin si riservano il diritto di attuare nuove penalità durante il corso della stagione.`,
  },
  {
    numero: '12',
    titolo: 'Premi Invernali e di Fine Stagione',
    ordine: 12,
    testo: `12.1. Al termine dell'ultima partita della 19a giornata vengono consegnati dei premi in mln a tutti i presidenti. Questi premi ammontano a 3 mln + la differenza di punti tra il presidente e il presidente primo in classifica.

12.2. Alla fine del campionato, in base al piazzamento effettuato, saranno distribuiti i seguenti milioni:
• 1ª posizione: 20 mln
• 2ª posizione: 25 mln
• 3ª posizione: 30 mln
• 4ª posizione: 35 mln
• 5ª posizione: 40 mln
• 6ª posizione: 45 mln
• 7ª posizione: 50 mln
• 8ª posizione: 55 mln

12.3. A questi vanno aggiunti i premi per la Coppa Italia:
• Vincitore (1° classificato): 5 mln
• Finalista (2° classificato): 3 mln
• Semifinalisti (3° e 4° posto): 1 mln

12.4. Premi individuali:
• Primo in gol schierati: 1 mln
• Primo in gol schierati contro: 2 mln
• Presidente con il miglior marcatore in rosa: 1 mln
• Presidente con il miglior assist man in rosa: 1 mln
• Presidente con il maggior numero di porte inviolate schierate: 1 mln

12.5. Penalità individuali:
• Presidente con il maggior numero di ammonizioni in campo: -1 mln
• Presidente con il maggior numero di espulsioni in campo: -1 mln

12.6. I premi in soldi (€) sono così ripartiti:
• 1° posto: ½ del montepremi totale
• 2° posto: ¼ del montepremi totale
• 3° posto: ⅛ del montepremi totale
• Vincitore Coppa: ⅛ del montepremi totale
• Vincitore Supercoppa: I 5€ aggiuntivi pagati dall'ultimo arrivato`,
  },
];

async function run() {
  // Cancella tutti gli articoli esistenti
  const { data: existing } = await supabase.from('regolamento_articoli').select('id');
  if (existing && existing.length > 0) {
    const ids = existing.map(r => r.id);
    const { error: delErr } = await supabase.from('regolamento_articoli').delete().in('id', ids);
    if (delErr) { console.error('Errore cancellazione:', delErr.message); process.exit(1); }
    console.log(`Cancellati ${ids.length} articoli esistenti.`);
  }

  // Inserisce i nuovi articoli
  const { error: insErr } = await supabase.from('regolamento_articoli').insert(articoli);
  if (insErr) { console.error('Errore inserimento:', insErr.message); process.exit(1); }
  console.log(`✅ Inseriti ${articoli.length} articoli del regolamento.`);
}

run();
