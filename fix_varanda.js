const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://sxplhqjnalnckzijvkjm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4cGxocWpuYWxuY2t6aWp2a2ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MDMyMzcsImV4cCI6MjA4MzM3OTIzN30.OTHLJ7b5XWCh2N4NI7ASRTrwfE9Frn0VMJZ3PuK8EQE';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fix() {
    const { data, error } = await supabase.from('room_types').select('*').eq('name', 'Suíte Varanda Térreo').single();
    if (error) {
        console.error("Error fetching:", error);
        return;
    }
    console.log("Current data:", {
        id: data.id,
        description: data.description,
        images: data.images ? data.images.map(i => i.substring(0, 30) + '...') : null,
        image_urls: data.image_urls
    });
    
    // We update description and clean images
    const updates = {
        description: "Suíte localizada no térreo, ideal para quem busca conforto e praticidade com uma varanda exclusiva.",
        // Let's grab an image from ibb that exists, or just use the first valid image. 
        // Wait, "varanda-terreo-01.jpg" was in the Quadruplo's images: https://i.ibb.co/b5gddH0Z/varanda-terreo-01.jpg
        image_urls: ["https://i.ibb.co/b5gddH0Z/varanda-terreo-01.jpg"],
        images: ["https://i.ibb.co/b5gddH0Z/varanda-terreo-01.jpg"] 
    };
    
    const { error: updateError } = await supabase.from('room_types').update(updates).eq('id', data.id);
    if (updateError) {
        console.error("Error updating:", updateError);
    } else {
        console.log("Successfully updated Suíte Varanda Térreo!");
    }
}
fix();
