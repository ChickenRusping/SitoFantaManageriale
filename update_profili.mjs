import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://ougxeheoaifcuetnmgrw.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91Z3hlaGVvYWlmY3VldG5tZ3J3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzIzMDgyMiwiZXhwIjoyMDg4ODA2ODIyfQ.JVpNt7UyXPqeBYcGyd3liBI8GGl7f6XO4lEe9k2W3HE'
);

async function run() {
  // Mostra tutti i profili
  const { data, error } = await supabase.from('profiles').select('id, email, nome, squadra, ruolo').order('squadra');
  if (error) { console.error('Errore lettura:', error.message); process.exit(1); }

  console.log('Profili esistenti:');
  data.forEach(p => console.log(`  ${p.squadra || '(no squadra)'} | ${p.email || '(no email)'} | ${p.nome || '(no nome)'} | ruolo: ${p.ruolo || 'null'} | id: ${p.id}`));

  // Imposta founder per raspanti981@gmail.com (Alcool Campi)
  const founder = data.find(p => p.email === 'raspanti981@gmail.com' || p.squadra === 'Alcool Campi');
  if (founder) {
    const { error: e1 } = await supabase.from('profiles').update({ ruolo: 'founder' }).eq('id', founder.id);
    if (e1) console.error('Errore founder:', e1.message);
    else console.log(`✅ ${founder.squadra || founder.email} → ruolo: founder`);
  } else {
    console.log('⚠️  Profilo founder (Alcool Campi / raspanti981@gmail.com) non trovato');
  }

  // Imposta admin per Borjcellona (borgio)
  const admin = data.find(p => p.squadra === 'Borjcellona');
  if (admin) {
    const { error: e2 } = await supabase.from('profiles').update({ ruolo: 'admin' }).eq('id', admin.id);
    if (e2) console.error('Errore admin:', e2.message);
    else console.log(`✅ ${admin.squadra || admin.email} → ruolo: admin`);
  } else {
    console.log('⚠️  Profilo admin (Borjcellona) non trovato');
  }
}

run();
