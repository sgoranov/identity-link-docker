# Changelog

# 1.1.0

### Added support for managing OAuth scopes for both users and clients.

Scopes can now be assigned and restricted at the user and client level, providing more granular control over what 
access tokens are allowed to access. Scope grants are evaluated against the configured audience, client assignments, 
user assignments, and authorization code grants.
This allows deployments to define more precise, audience-specific permissions while still supporting group-based 
authorization where broader roles or memberships are sufficient.


### Vector-based log collection and retention

Added centralized log collection using Vector.
Application and container logs are now automatically collected and made available directly in the logs/ directory. 
This makes troubleshooting and log inspection much easier without requiring users to connect to or log into individual 
containers.
Logs are also managed through the new retention mechanism, helping keep log storage under control while retaining 
recent logs for troubleshooting and operational purposes.