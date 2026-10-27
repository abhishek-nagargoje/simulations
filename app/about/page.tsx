import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/brand';

export const metadata: Metadata = { title: 'About' };

export default function AboutPage() {
  return (
    <main className="center-page">
      <div className="card prose-card">
        <div className="card-body stack">
          <Brand />
          <h1>About</h1>
          <p>Access to each application is granted and ended by teachers.</p>
          <p>
            The SAP ERP application follows SAP transaction conventions. It is an independent application; it is not
            provided by, operated by, affiliated with or endorsed by SAP SE, and it is not connected to any SAP system.
            Postings are stored only in this service’s own database. SAP and the SAP logo are trademarks of SAP SE.
          </p>
          <p>
            The HR Management application follows the Darwinbox interface. It is an independent application; it is not
            provided by, operated by, affiliated with or endorsed by Darwinbox. Darwinbox is a trademark of its owner.
          </p>
          <p>
            Business partners, employees, documents and bank details in the applications are sample records. They do not
            describe real organizations or people.
          </p>
          <p className="small">
            <Link href="/">← Back</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
