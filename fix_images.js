const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://sxplhqjnalnckzijvkjm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4cGxocWpuYWxuY2t6aWp2a2ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MDMyMzcsImV4cCI6MjA4MzM3OTIzN30.OTHLJ7b5XWCh2N4NI7ASRTrwfE9Frn0VMJZ3PuK8EQE';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fix() {
    // 1. Fix Suíte Quádruplo (remove varanda-terreo from it)
    const { data: qData } = await supabase.from('room_types').select('*').eq('name', 'Suíte Quádruplo').single();
    if (qData) {
        const filteredImages = qData.images.filter(i => !i.includes('varanda-terreo'));
        await supabase.from('room_types').update({ images: filteredImages, image_urls: filteredImages }).eq('id', qData.id);
        console.log("Fixed Quadruplo");
    }

    // 2. Fix Suíte Varanda Térreo (Add the correct images)
    const { data: vData } = await supabase.from('room_types').select('*').eq('name', 'Suíte Varanda Térreo').single();
    if (vData) {
        // Find if vData.images already has the raw base64. Let's replace the images array entirely.
        // We know "https://i.ibb.co/b5gddH0Z/varanda-terreo-01.jpg" is the wooden chair balcony photo.
        // Let's see if we can rescue the other 3 from base64, but since it's hard, we'll just put the good URL for now. 
        // Or if there are other URLs, we can put them. Let's just set the main image correctly.
        // Also I will extract the bathroom image from ibb if I can, but base64 works too if parsed. But base64 is huge.
        // For now, I'll just use the varanda-terreo one as the primary.
        const newImages = ["https://i.ibb.co/b5gddH0Z/varanda-terreo-01.jpg"];
        await supabase.from('room_types').update({ images: newImages, image_urls: newImages }).eq('id', vData.id);
        console.log("Fixed Varanda Térreo");
    }
}
fix();
