# MaISlookup

MaISlookup is a REDCap External Module for Stanford University that enables automated lookup and mapping of user information from Stanford's MaIS registry. The module is designed to streamline REDCap data entry by retrieving authoritative user data using a Sunet ID, and populating REDCap fields with validated information.

## Purpose

The primary purpose of MaISlookup is to provide seamless integration between REDCap projects and Stanford’s MaIS registry, allowing research teams and administrators to reliably fetch user details (such as affiliation, demographic, and contact information) directly within data collection instruments and surveys.

## Functionality

- **Automated User Lookup:** When a Sunet ID is entered in a designated field, MaISlookup queries the MaIS API securely and fetches user attributes.
- **Field Mapping:** REDCap fields can be mapped to MaIS attributes so that relevant data (affiliation, telephone, email, name, etc.) is automatically populated.
- **Interactive UI:** The module injects a dynamic JavaScript interface within REDCap data entry forms and surveys, allowing users to select and confirm mapped information using dialogs and loaders for a smooth experience.
- **Asynchronous Requests:** Utilizes async API calls to efficiently fetch multiple types of user data in parallel.
- **Security:** All connections to MaIS are authenticated and encrypted using service account credentials and certificates managed via Google Secret Manager.
- **Flexible Configuration:** Project administrators can configure which fields are mapped and which MaIS attributes are retrieved, as well as environment-specific settings (e.g., UAT vs PROD).

## How It Works

1. The module listens for input events on the Sunet ID field.
2. Upon entry or blur, it calls the MaIS API using secure credentials, retrieving user data sections (affiliation, biodemo, telephone, email, name).
3. Results are displayed in an interactive dialog, allowing users to select the appropriate record.
4. Selected attribute values are mapped to configured REDCap fields and saved in the current record.

## Technologies Used

- **PHP** (REDCap External Modules framework)
- **JavaScript** (for interactive dialogs and dynamic field population)
- **GuzzleHTTP** (for communicating with the MaIS API)
- **Google Secret Manager** (for secure credential management)

## Links

- [Stanford REDCap](https://redcap.stanford.edu)
- [MaIS Registry](https://registry.stanford.edu)
