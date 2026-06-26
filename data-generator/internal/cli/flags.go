package cli

import (
	"flag"
	"fmt"
	"os"
)

// ValidateRequiredFlags checks if any required string flags were left empty
func ValidateRequiredFlags(required map[string]string, usageFunc func()) {
	var missing []string
	for name, value := range required {
		if value == "" {
			missing = append(missing, fmt.Sprintf("--%s", name))
		}
	}
	if len(missing) > 0 {
		fmt.Fprintf(os.Stderr, "Error: Missing required arguments: %v\n", missing)
		if usageFunc != nil {
			usageFunc()
		} else {
			flag.Usage()
		}
		os.Exit(1)
	}
}