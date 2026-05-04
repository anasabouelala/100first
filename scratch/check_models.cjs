const apiKey = "AIzaSyCc1d-JqoKOAUVBK2BrgOOViTEMGBX5wXI";
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

async function check() {
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.error) {
            console.error(data.error);
            return;
        }
        console.log("VALID MODELS:");
        data.models.forEach(m => {
            if (m.supportedGenerationMethods.includes('generateContent')) {
                console.log(m.name.replace('models/', ''));
            }
        });
    } catch (e) {
        console.error(e);
    }
}
check();
