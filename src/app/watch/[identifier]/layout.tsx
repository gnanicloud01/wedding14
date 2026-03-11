import { Metadata, ResolvingMetadata } from 'next';

type Props = {
    params: Promise<{ code: string }>
}

export async function generateMetadata(
    { params }: Props,
    parent: ResolvingMetadata
): Promise<Metadata> {
    const { code } = await params;

    // In production, fetch wedding info from D1 here
    // For this design demo, we use the code in the title

    return {
        title: `Wedding Gallery - ${code} | Wedding OTT`,
        description: "Watch your cinematic wedding films in stunning 4K quality. Private, secure, and permanent.",
        openGraph: {
            title: `Our Wedding Journey - ${code}`,
            description: "A private vault of our most cherished memories.",
            images: ['https://images.unsplash.com/photo-1519741497674-611481863552?q=80&w=1200'],
            type: 'video.other',
        },
        twitter: {
            card: 'summary_large_image',
            title: `Our Wedding Journey - ${code}`,
        }
    }
}

export default function WeddingLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="wedding-scope">
            {children}
        </div>
    );
}
